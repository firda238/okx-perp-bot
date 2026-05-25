export default function GlassCard({ children, className = "", glow = false }) {
  return (
    <section className={`glass-card ${glow ? "glass-glow" : ""} ${className}`}>
      {children}
    </section>
  );
}
