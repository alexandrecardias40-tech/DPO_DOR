
"""Pivot table helpers."""
from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple, Union

import numpy as np
import pandas as pd


@dataclass
class PivotResult:
    dataset_id: str
    rows: List[str]
    columns: List[str]
    measures: List[str]
    aggregator: str
    row_headers: List[List[Any]]
    column_headers: List[List[Any]]
    values: List[List[Any]]
    row_totals: List[Any]
    column_totals: List[Any]
    grand_total: Optional[Any]
    summary_value: Optional[Any] = None
    table: Optional[pd.DataFrame] = None
    column_keys: List[str] = field(default_factory=list)
    calculations: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)
    value_format: str = "number"
    summary_values: Dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "datasetId": self.dataset_id,
            "rows": self.rows,
            "columns": self.columns,
            "measure": self.measures[0] if self.measures else None,
            "measures": self.measures,
            "aggregator": self.aggregator,
            "rowHeaders": self.row_headers,
            "columnHeaders": self.column_headers,
            "columnKeys": self.column_keys,
            "values": self.values,
            "rowTotals": self.row_totals,
            "columnTotals": self.column_totals,
            "grandTotal": self.grand_total,
            "summaryValue": self.summary_value,
            "summaryValues": self.summary_values,
            "calculations": self.calculations,
            "valueFormat": self.value_format,
        }


class PivotError(RuntimeError):
    """Raised when we cannot produce a pivot table."""


class CalculationError(PivotError):
    """Raised when calculated metrics cannot be produced."""


AGGREGATIONS_META: Dict[str, Dict[str, Any]] = {
    "sum": {"func": "sum", "label": "Somar", "format": "number"},
    "avg": {"func": "mean", "label": "Média", "format": "number"},
    "count": {"func": "count", "label": "Contagem", "format": "number"},
    "distinct_count": {"func": "nunique", "label": "Contagem distinta", "format": "number"},
    "min": {"func": "min", "label": "Mínimo", "format": "number"},
    "max": {"func": "max", "label": "Máximo", "format": "number"},
    "money_sum": {"func": "sum", "label": "Somar (R$)", "format": "currency"},
}


def available_aggregations() -> List[Dict[str, str]]:
    order = ["sum", "money_sum", "avg", "count", "distinct_count", "min", "max"]
    aggregations = []
    for key in order:
        meta = AGGREGATIONS_META.get(key)
        if not meta:
            continue
        aggregations.append(
            {
                "id": key,
                "label": meta["label"],
                "format": meta.get("format", "number"),
            }
        )
    return aggregations


def _to_series_list(items: Iterable[Any]) -> List[List[Any]]:
    values: List[List[Any]] = []
    for value in items:
        if isinstance(value, tuple):
            values.append([_to_native(v) for v in value])
        else:
            values.append([_to_native(value)])
    return values


def _to_native(value: Any) -> Any:
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:  # pragma: no cover - defensive
            return value
    return value


def _column_to_key(column: Any) -> str:
    if isinstance(column, tuple):
        flattened = [_to_native(part) for part in column]
    else:
        flattened = [_to_native(column)]
    return json.dumps(flattened, ensure_ascii=False)


def _ensure_measure(frame: pd.DataFrame, measure: str) -> None:
    if measure not in frame.columns:
        raise PivotError(f"Coluna '{measure}' não encontrada na base carregada.")


def _resolve_agg(aggregator: str) -> Dict[str, Any]:
    meta = AGGREGATIONS_META.get(aggregator)
    if not meta:
        raise PivotError(f"Agregador '{aggregator}' não é suportado.")
    return meta


def _series_from_constant(value: float, index: pd.Index) -> pd.Series:
    return pd.Series(value, index=index, dtype=float)


def _apply_decimals(series: pd.Series, options: Optional[Dict[str, Any]]) -> pd.Series:
    decimals = (options or {}).get("decimals")
    if decimals is None:
        return series
    try:
        decimals_int = int(decimals)
    except (TypeError, ValueError):
        raise CalculationError("Valor de 'decimals' inválido.")
    return series.round(decimals_int)


def _evaluate_operation(
    series_list: List[pd.Series],
    operation: Optional[str],
    options: Optional[Dict[str, Any]] = None,
) -> pd.Series:
    if not series_list:
        raise CalculationError("Operação requer pelo menos um operando.")

    options = options or {}
    op = (operation or "add").lower()
    left = series_list[0].copy()

    if op in {"add", "sum"}:
        result = left.fillna(0)
        for series in series_list[1:]:
            result = result.add(series.fillna(0), fill_value=0)
    elif op in {"subtract", "sub"}:
        result = left
        for series in series_list[1:]:
            result = result.subtract(series.fillna(0), fill_value=0)
    elif op in {"multiply", "mul"}:
        result = left
        for series in series_list[1:]:
            result = result.multiply(series, fill_value=1)
    elif op in {"divide", "div"}:
        if len(series_list) < 2:
            raise CalculationError("Operação de divisão requer ao menos dois operandos.")
        denominator = series_list[1].replace(0, np.nan)
        result = left.divide(denominator)
        for series in series_list[2:]:
            denominator = series.replace(0, np.nan)
            result = result.divide(denominator)
    elif op in {"percentage", "percent"}:
        if len(series_list) < 2:
            raise CalculationError("Operação percentual requer dois operandos.")
        denominator = series_list[1].replace(0, np.nan)
        factor = options.get("factor", 100)
        try:
            factor = float(factor)
        except (TypeError, ValueError):
            factor = 100.0
        result = left.divide(denominator) * factor
    elif op in {"greater_than", "gt"}:
        if len(series_list) < 2:
            raise CalculationError("Operação 'maior que' requer dois operandos.")
        result = (left > series_list[1]).astype(int)
    elif op in {"less_than", "lt"}:
        if len(series_list) < 2:
            raise CalculationError("Operação 'menor que' requer dois operandos.")
        result = (left < series_list[1]).astype(int)
    elif op == "between":
        lower = options.get("lower")
        upper = options.get("upper")
        if lower is None or upper is None:
            raise CalculationError("Operação 'entre' requer limites inferior e superior.")
        try:
            lower_val = float(lower)
            upper_val = float(upper)
        except (TypeError, ValueError):
            raise CalculationError("Limites fornecidos para 'entre' não são numéricos.")
        result = left.between(lower_val, upper_val, inclusive="both").astype(int)
    else:
        raise CalculationError(f"Operação '{operation}' não é suportada.")

    result = result.replace([np.inf, -np.inf], np.nan)

    if result.dtype == bool:
        result = result.astype(int)

    return _apply_decimals(result, options)


def _resolve_pre_operand(frame: pd.DataFrame, operand: Dict[str, Any]) -> pd.Series:
    operand = operand or {}
    op_type = operand.get("type", "column")

    if op_type == "column":
        field = operand.get("field")
        if field not in frame.columns:
            raise CalculationError(f"Campo '{field}' não encontrado para cálculo.")
        return pd.to_numeric(frame[field], errors="coerce")

    if op_type == "value":
        value = operand.get("value")
        if value is None or value == "":
            value = 0
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            raise CalculationError("Valor constante inválido em cálculo.")
        return _series_from_constant(numeric, frame.index)

    raise CalculationError(f"Tipo de operando '{op_type}' não é suportado.")


def _resolve_post_operand(
    table: pd.DataFrame,
    column_lookup: Dict[str, Any],
    operand: Dict[str, Any],
) -> pd.Series:
    operand = operand or {}
    op_type = operand.get("type", "column")

    if op_type == "column":
        key = operand.get("columnKey")
        if key not in column_lookup:
            raise CalculationError(
                f"Coluna de referência '{key}' não foi encontrada no resultado do pivot."
            )
        column_label = column_lookup[key]
        return pd.to_numeric(table[column_label], errors="coerce")

    if op_type == "value":
        value = operand.get("value")
        if value is None or value == "":
            value = 0
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            raise CalculationError("Valor constante inválido em cálculo pós-pivot.")
        return _series_from_constant(numeric, table.index)

    raise CalculationError(f"Tipo de operando '{op_type}' não é suportado.")


def _build_calculated_column_label(name: str, column_levels: int) -> Any:
    label = name or "Calculado"
    if column_levels <= 1:
        return label
    parts = ["Calculado"] * column_levels
    parts[-1] = label
    return tuple(parts)


def _create_pivot_result_from_grouped(
    *,
    dataset_id: str,
    rows: List[str],
    columns: List[str],
    measures: List[str],
    aggregator: str,
    value_format: str,
    grouped: pd.DataFrame,
    summary_values: Optional[Dict[str, Any]] = None,
) -> PivotResult:
    grouped = grouped.copy()
    numeric = grouped.apply(lambda col: pd.to_numeric(col, errors="coerce"))

    values_matrix = [
        [_to_native(val) for val in numeric.iloc[row_idx].tolist()]
        for row_idx in range(numeric.shape[0])
    ]

    row_headers = _to_series_list(grouped.index)
    column_headers = _to_series_list(grouped.columns)
    column_keys = [_column_to_key(col) for col in grouped.columns]

    row_totals = [
        _to_native(numeric.iloc[row_idx].sum(skipna=True))
        for row_idx in range(numeric.shape[0])
    ]
    column_totals = [
        _to_native(numeric.iloc[:, col_idx].sum(skipna=True))
        for col_idx in range(numeric.shape[1])
    ]
    grand_total = _to_native(np.nansum(numeric.to_numpy()))

    return PivotResult(
        dataset_id=dataset_id,
        rows=rows,
        columns=columns,
        measures=measures,
        aggregator=aggregator,
        row_headers=row_headers,
        column_headers=column_headers,
        values=values_matrix,
        row_totals=row_totals,
        column_totals=column_totals,
        grand_total=grand_total,
        summary_value=None,
        table=grouped,
        column_keys=column_keys,
        calculations={"pre": [], "post": []},
        value_format=value_format,
        summary_values=summary_values or {},
    )


def apply_pre_calculations(
    frame: pd.DataFrame, calculations: Iterable[Dict[str, Any]]
) -> pd.DataFrame:
    relevant = [
        calc
        for calc in (calculations or [])
        if (calc.get("stage") or "pre").lower() in {"pre", "both"}
    ]
    if not relevant:
        return frame

    df = frame.copy()
    for calc in relevant:
        result_field = calc.get("resultField")
        if not result_field:
            raise CalculationError(
                "Campo 'resultField' é obrigatório para cálculos pré consulta."
            )
        operation = (calc.get("operation") or "add").lower()
        options = calc.get("options") or {}
        if operation == "expression":
            result_series, _ = _evaluate_expression_series(
                df,
                options.get("expression"),
                stage="pre",
            )
            result_series = _apply_decimals(result_series, options)
        else:
            operands = calc.get("inputs") or []
            series_list = [_resolve_pre_operand(df, operand) for operand in operands]
            result_series = _evaluate_operation(
                series_list,
                calc.get("operation"),
                options,
            )
        df[result_field] = result_series
    return df


def build_pivot(
    dataset_id: str,
    frame: pd.DataFrame,
    rows: Optional[List[str]],
    columns: Optional[List[str]],
    measure: Union[str, Sequence[str]],
    aggregator: str,
) -> PivotResult:
    if isinstance(measure, (list, tuple, set)):
        measures = [str(m) for m in measure if m]
    else:
        measures = [measure] if measure else []

    if not measures:
        raise PivotError("É necessário escolher pelo menos uma medida numérica.")

    for selected in measures:
        _ensure_measure(frame, selected)

    agg_meta = _resolve_agg(aggregator)
    aggfunc = agg_meta["func"]
    value_format = agg_meta.get("format", "number")

    rows = rows or []
    columns = columns or []

    if not rows and not columns:
        summary_values = {
            measure_name: _to_native(frame[measure_name].agg(aggfunc))
            for measure_name in measures
        }
        first_value = next(iter(summary_values.values())) if summary_values else None
        return PivotResult(
            dataset_id=dataset_id,
            rows=[],
            columns=[],
            measures=measures,
            aggregator=aggregator,
            row_headers=[],
            column_headers=[],
            values=[],
            row_totals=[],
            column_totals=[],
            grand_total=first_value,
            summary_value=first_value,
            table=None,
            column_keys=[],
            calculations={"pre": [], "post": []},
            value_format=value_format,
            summary_values=summary_values,
        )

    pivot_values: Union[str, List[str]]
    if len(measures) == 1:
        pivot_values = measures[0]
    else:
        pivot_values = measures

    if rows and columns:
        grouped = pd.pivot_table(
            frame,
            values=pivot_values,
            index=rows,
            columns=columns,
            aggfunc=aggfunc,
            dropna=False,
        )
    elif rows:
        grouped = frame.groupby(rows, dropna=False)[pivot_values].agg(aggfunc)
    else:  # columns only
        grouped = frame.groupby(columns, dropna=False)[pivot_values].agg(aggfunc)
        grouped = pd.DataFrame(grouped).transpose()

    if isinstance(grouped, pd.Series):
        grouped = grouped.to_frame(name=measures[0])

    grouped = grouped.sort_index(axis=0)
    grouped = grouped.sort_index(axis=1)

    return _create_pivot_result_from_grouped(
        dataset_id=dataset_id,
        rows=rows,
        columns=columns,
        measures=measures,
        aggregator=aggregator,
        value_format=value_format,
        grouped=grouped,
    )


def apply_post_calculations(
    result: PivotResult, calculations: Iterable[Dict[str, Any]]
) -> PivotResult:
    relevant = [
        calc
        for calc in (calculations or [])
        if (calc.get("stage") or "post").lower() in {"post", "both"}
    ]
    if not relevant:
        result.calculations.setdefault("post", [])
        return result

    if result.table is None:
        raise CalculationError(
            "Não é possível adicionar colunas calculadas sem dimensões de coluna na tabela dinâmica."
        )

    table = result.table.copy()
    if isinstance(table.columns, pd.MultiIndex):
        column_levels = table.columns.nlevels
    else:
        column_levels = 1

    column_keys = list(result.column_keys)
    column_lookup = {key: col for key, col in zip(column_keys, table.columns)}

    for calc in relevant:
        operands = calc.get("inputs") or []
        operation = (calc.get("operation") or "add").lower()
        options = calc.get("options") or {}
        referenced_keys: List[str] = []
        if operation == "expression":
            result_series, referenced_keys = _evaluate_expression_series(
                table,
                options.get("expression"),
                stage="post",
                column_lookup=column_lookup,
            )
            result_series = _apply_decimals(result_series, options)
        else:
            series_list = [
                _resolve_post_operand(table, column_lookup, operand)
                for operand in operands
            ]
            result_series = _evaluate_operation(
                series_list,
                calc.get("operation"),
                options,
            )
            referenced_keys = [
                operand.get("columnKey")
                for operand in operands
                if operand.get("type", "column") == "column"
            ]

        result_key = calc.get("resultKey") or calc.get("id") or f"calc::{len(column_keys)}"
        new_label = _build_calculated_column_label(calc.get("name") or result_key, column_levels)

        table[new_label] = result_series
        current_columns = list(table.columns)
        current_columns.remove(new_label)

        positions = [column_keys.index(key) for key in referenced_keys if key in column_keys]
        insert_pos = (max(positions) + 1) if positions else len(column_keys)

        current_columns.insert(insert_pos, new_label)
        table = table[current_columns]

        column_keys.insert(insert_pos, result_key)
        column_lookup[result_key] = new_label

    updated = _create_pivot_result_from_grouped(
        dataset_id=result.dataset_id,
        rows=result.rows,
        columns=result.columns,
        measures=result.measures,
        aggregator=result.aggregator,
        value_format=result.value_format,
        grouped=table,
        summary_values=result.summary_values,
    )
    updated.summary_value = result.summary_value
    updated.calculations["pre"] = copy.deepcopy(result.calculations.get("pre", []))
    updated.calculations["post"] = copy.deepcopy(relevant)
    return updated


def suggest_measures(frame: pd.DataFrame) -> List[str]:
    numeric_cols = frame.select_dtypes(include=["number", "bool"]).columns.tolist()
    if numeric_cols:
        return numeric_cols
    return frame.columns.tolist()


def _flatten_header(header: Any) -> str:
    if isinstance(header, list):
        cleaned = [str(v) for v in header if v is not None]
        return " / ".join(cleaned) if cleaned else "Total"
    if isinstance(header, tuple):
        cleaned = [str(v) for v in header if v is not None]
        return " / ".join(cleaned) if cleaned else "Total"
    if header is None:
        return "Total"
    return str(header)


EXPRESSION_PLACEHOLDER = re.compile(r"\{([^{}]+)\}")


def _match_post_column(
    column_lookup: Dict[str, Any],
    table: pd.DataFrame,
    token: str,
) -> Tuple[Any, Optional[str]]:
    normalized = token.strip()
    if not normalized:
        raise CalculationError("Identificador de coluna vazio na expressão personalizada.")

    if normalized in column_lookup:
        return column_lookup[normalized], normalized

    for key, label in column_lookup.items():
        if _flatten_header(label) == normalized:
            return label, key

    for label in table.columns:
        flattened = _flatten_header(label)
        if flattened == normalized or str(label) == normalized:
            matched_key = None
            for candidate_key, candidate_label in column_lookup.items():
                if candidate_label == label:
                    matched_key = candidate_key
                    break
            return label, matched_key

    raise CalculationError(f"Coluna '{token}' não foi encontrada para a expressão personalizada.")


def _evaluate_expression_series(
    frame: pd.DataFrame,
    expression: Optional[str],
    *,
    stage: str,
    column_lookup: Optional[Dict[str, Any]] = None,
) -> Tuple[pd.Series, List[str]]:
    expr = (expression or "").strip()
    if not expr:
        raise CalculationError("Expressão personalizada não foi informada.")

    token_to_var: Dict[str, str] = {}
    series_map: Dict[str, pd.Series] = {}
    referenced_keys: List[str] = []

    def resolve_pre_series(token: str) -> pd.Series:
        if token not in frame.columns:
            raise CalculationError(f"Coluna '{token}' não encontrada na expressão.")
        return pd.to_numeric(frame[token], errors="coerce")

    def resolve_post_series(token: str) -> pd.Series:
        if column_lookup is None:
            raise CalculationError("Não há colunas disponíveis para calcular a expressão.")
        label, key = _match_post_column(column_lookup, frame, token)
        series = pd.to_numeric(frame[label], errors="coerce")
        if key and key not in referenced_keys:
            referenced_keys.append(key)
        return series

    def replace_placeholder(match: re.Match[str]) -> str:
        token = match.group(1).strip()
        if not token:
            raise CalculationError("A expressão contém identificadores vazios.")
        if token not in token_to_var:
            var_name = f"__col_{len(token_to_var)}"
            token_to_var[token] = var_name
            if stage == "pre":
                series_map[var_name] = resolve_pre_series(token)
            else:
                series_map[var_name] = resolve_post_series(token)
        return token_to_var[token]

    transformed = EXPRESSION_PLACEHOLDER.sub(replace_placeholder, expr)

    if not token_to_var:
        try:
            constant_value = float(pd.eval(expr, engine="python"))
        except Exception:
            try:
                constant_value = float(eval(expr, {"__builtins__": {}}, {}))
            except Exception as exc:  # pragma: no cover - defensive
                raise CalculationError("Expressão personalizada inválida.") from exc
        index = frame.index
        return _series_from_constant(constant_value, index), referenced_keys

    try:
        result = pd.eval(
            transformed,
            local_dict=series_map,
            global_dict={"__builtins__": {}},
            engine="python",
        )
    except Exception as exc:  # pragma: no cover - runtime safety
        raise CalculationError("Erro ao avaliar a expressão personalizada.") from exc

    if isinstance(result, (int, float)):
        reference_series = next(iter(series_map.values()))
        series = _series_from_constant(result, reference_series.index)
    elif isinstance(result, pd.Series):
        series = result
    else:
        try:
            series = pd.Series(result, index=frame.index)
        except Exception as exc:
            raise CalculationError("Expressão personalizada retornou um resultado inválido.") from exc

    series = series.replace([np.inf, -np.inf], np.nan)
    return series, referenced_keys


def pivot_result_to_dataframe(result: PivotResult) -> pd.DataFrame:
    if result.table is None:
        summary = dict(result.summary_values) if result.summary_values else {}
        if not summary:
            key = result.measures[0] if result.measures else "Valor"
            summary[key] = result.summary_value
        return pd.DataFrame([summary])

    row_dim_count = len(result.rows)
    row_labels = result.rows[:] if row_dim_count else ["Medida"]

    column_labels = [_flatten_header(header) for header in result.column_headers]
    if not column_labels and result.measures:
        column_labels = result.measures[:]
    if not column_labels:
        column_labels = []

    rows_data: List[List[Any]] = []
    for idx, values in enumerate(result.values):
        header_values = result.row_headers[idx] if idx < len(result.row_headers) else []
        if row_dim_count:
            labels = ["" for _ in range(row_dim_count)]
            for pos in range(min(row_dim_count, len(header_values))):
                labels[pos] = "" if header_values[pos] is None else str(header_values[pos])
        else:
            labels = [_flatten_header(header_values) if header_values else (result.measures[idx] if idx < len(result.measures) else "Total")]
        const_values = [_to_native(val) for val in values]
        if len(const_values) < len(column_labels):
            const_values.extend([None] * (len(column_labels) - len(const_values)))
        total_value = result.row_totals[idx] if idx < len(result.row_totals) else None
        rows_data.append(labels + const_values + [total_value])

    total_labels = ["Total"] + ["" for _ in range(len(row_labels) - 1)]
    totals = [_to_native(val) for val in result.column_totals]
    if len(totals) < len(column_labels):
        totals.extend([None] * (len(column_labels) - len(totals)))
    totals.append(result.grand_total)
    rows_data.append(total_labels + totals)

    columns = row_labels + column_labels + ["Total"]
    return pd.DataFrame(rows_data, columns=columns)
