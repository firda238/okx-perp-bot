export default function IconButton({ icon: Icon, label, className = "", onClick, disabled = false }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled || !onClick} className={`icon-button ${className}`}>
      <Icon size={18} strokeWidth={1.8} />
    </button>
  );
}
