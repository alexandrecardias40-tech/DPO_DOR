interface DateDisplayProps {
  date: string;
  label?: string;
}

export function DateDisplay({ date, label }: DateDisplayProps) {
  const formattedDate = new Date(date).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  if (label) {
    return (
      <div>
        <span className="font-medium">{label}:</span> {formattedDate}
      </div>
    );
  }

  return <span>{formattedDate}</span>;
}