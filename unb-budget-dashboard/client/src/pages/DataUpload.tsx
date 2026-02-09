import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import DashboardLayout from '@/components/DashboardLayout';
import { Upload, CheckCircle, AlertCircle, Loader } from 'lucide-react';

type UploadStatus = 'idle' | 'success' | 'error';

type UploadSummary = {
  referenceYear?: number | null;
  rowsImported?: number;
  sourceSheet?: string;
};

const fileToBase64 = (file: File, onProgress?: (progress: number) => void): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;
      const progress = Math.min(60, Math.round((event.loaded / event.total) * 60));
      onProgress(progress);
    };

    reader.onload = () => {
      const result = String(reader.result || '');
      const [, base64 = ''] = result.split(',');
      if (!base64) {
        reject(new Error('Nao foi possivel converter o arquivo para upload.'));
        return;
      }
      resolve(base64);
    };

    reader.onerror = () => reject(new Error('Falha ao ler o arquivo selecionado.'));
    reader.readAsDataURL(file);
  });
};

export default function DataUpload() {
  const utils = trpc.useUtils();
  const uploadMutation = trpc.budget.uploadFile.useMutation();

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<UploadSummary | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.xlsx') && !selectedFile.name.endsWith('.xls')) {
      setStatus('error');
      setMessage('Selecione um arquivo Excel (.xlsx ou .xls).');
      return;
    }

    setFile(selectedFile);
    setStatus('idle');
    setMessage('');
    setSummary(null);
  };

  const handleUpload = async () => {
    if (!file) {
      setStatus('error');
      setMessage('Selecione uma planilha para continuar.');
      return;
    }

    setUploading(true);
    setProgress(0);
    setStatus('idle');
    setMessage('');
    setSummary(null);

    try {
      const contentBase64 = await fileToBase64(file, setProgress);
      setProgress(75);

      const response = await uploadMutation.mutateAsync({
        contentBase64,
        fileName: file.name,
      });

      if (!response.success) {
        throw new Error(response.message || 'Falha ao processar a planilha.');
      }

      await Promise.all([
        utils.budget.getKPIs.invalidate(),
        utils.budget.getUGRAnalysis.invalidate(),
        utils.budget.getMonthlyConsumption.invalidate(),
        utils.budget.getExpiringContracts.invalidate(),
        utils.budget.getExpiredContracts.invalidate(),
        utils.budget.getAllData.invalidate(),
        utils.budget.getMetadata.invalidate(),
      ]);

      setProgress(100);
      setStatus('success');
      setMessage('Planilha carregada e dashboard atualizado com sucesso.');
      setSummary({
        referenceYear: response.metadata?.reference_year,
        rowsImported: response.rowsImported,
        sourceSheet: response.metadata?.source_sheet,
      });
      setFile(null);

      setTimeout(() => {
        setProgress(0);
      }, 1200);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Erro ao fazer upload da planilha.');
      setProgress(0);
    } finally {
      setUploading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Atualizar Dados</h1>
          <p className="text-slate-600 mt-1">
            Carregue uma planilha Excel para substituir os dados atuais do dashboard.
          </p>
        </div>

        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <Upload className="w-5 h-5" />
              Carregar Planilha
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label htmlFor="file-input" className="block">
                <button
                  type="button"
                  onClick={() => document.getElementById('file-input')?.click()}
                  className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  Selecionar Arquivo
                </button>
              </label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
                id="file-input"
              />
            </div>

            {file && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-slate-700">
                  <strong>Arquivo selecionado:</strong> {file.name}
                </p>
                <p className="text-xs text-slate-600 mt-1">
                  Tamanho: {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            )}

            {status === 'success' && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex gap-3">
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-green-900">{message}</p>
                  {summary && (
                    <p className="text-xs text-green-800">
                      {summary.rowsImported ?? 0} registros importados
                      {summary.sourceSheet ? ` | Aba: ${summary.sourceSheet}` : ''}
                      {summary.referenceYear ? ` | Ano de referencia: ${summary.referenceYear}` : ''}
                    </p>
                  )}
                </div>
              </div>
            )}

            {status === 'error' && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-900">{message}</p>
                </div>
              </div>
            )}

            {uploading && progress > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-700">Processando planilha...</p>
                  <p className="text-sm font-semibold text-blue-600">{progress}%</p>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className={`w-full px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${!file || uploading
                ? 'bg-slate-300 text-slate-600 cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700'
                }`}
            >
              {uploading && <Loader className="w-5 h-5 animate-spin" />}
              {uploading ? 'Enviando...' : 'Atualizar Dashboard'}
            </button>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-blue-50 border-l-4 border-l-blue-600">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900">Como funciona</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm text-slate-700">
              <p>1. Selecione uma planilha Excel com estrutura semelhante a Base.</p>
              <p>2. O sistema identifica automaticamente a aba principal e as colunas relevantes.</p>
              <p>3. Os indicadores e graficos sao recalculados imediatamente apos o upload.</p>
              <p>4. Para atualizacoes futuras, basta repetir o processo com a nova versao da planilha.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
