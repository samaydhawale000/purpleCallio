export default function DemoCard({
  title,
  description,
  icon,
  buttonText,
  onClick,
  disabled = false,
}) {
  return (
    <div
      className="rounded-2xl border border-[#E7DFF5] bg-white p-7 flex flex-col"
    >

      <div className="w-12 h-12 rounded-xl bg-[#7F40E8]/10 flex items-center justify-center mb-6 text-[#7F40E8]">
        {icon}
      </div>

      <h2 className="text-[#170B2E] text-xl font-semibold">
        {title}
      </h2>

      <p className="text-[#3D3650] mt-3 flex-1">
        {description}
      </p>

      <button
        disabled={disabled}
        onClick={onClick}
        className="mt-8 rounded-xl py-3 text-white font-medium transition hover:opacity-90 disabled:opacity-50"
        style={{
          background:
            "linear-gradient(135deg,#7F40E8,#410686)",
        }}
      >
        {buttonText}
      </button>

    </div>
  );
}