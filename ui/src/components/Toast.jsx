import { useApp } from '../lib/store';

export default function Toast() {
  const { toast } = useApp();
  if (!toast) return null;

  return (
    <div className={`toast visible ${toast.type}`}>
      {toast.message}
    </div>
  );
}
