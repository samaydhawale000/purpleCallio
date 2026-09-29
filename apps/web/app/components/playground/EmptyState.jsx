import { Rocket } from 'lucide-react';

export default function EmptyState() {
  return (
    <div className="border rounded-2xl p-16 text-center bg-white mt-10">

      <div className="mb-5 flex justify-center text-[#7F40E8]">
        <Rocket size={48} />
      </div>

      <h2 className="text-2xl font-semibold">
        No Test Session
      </h2>

      <p className="text-[#3D3650] mt-3">
        Create a Video or Audio session to start testing.
      </p>

    </div>
  );
}
