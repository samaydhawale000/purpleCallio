import { Rocket } from 'lucide-react';

export default function Hero() {
  return (
    <div className="mb-12">

      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#7F40E8]/20 bg-[#7F40E8]/10 text-[#6425C4] text-sm mb-5">
        <Rocket size={15} /> Live Playground
      </div>

      <h1 className="text-5xl font-bold text-[#170B2E] leading-tight">
        Experience PurpleCallio
        <br />
        before integrating it.
      </h1>

      <p className="mt-5 text-[#3D3650] max-w-2xl text-lg leading-8">
        Test real video calls, audio calls and screen sharing without
        writing a single line of code.
      </p>

    </div>
  );
}
