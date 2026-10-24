'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Bot, Code2, Languages, Mic, ShieldCheck, Layers3 } from 'lucide-react';
import { AuthCard } from '../components/auth/AuthCard';
import logo from '../assets/images/logo.webp';

const capabilities = [
  { icon: Mic, title: 'Voice & Video', copy: 'Reliable real-time conversations' },
  { icon: Languages, title: 'Live Translate', copy: 'Speak naturally across languages' },
  { icon: Bot, title: 'AI Voice Agents', copy: 'Automate conversations intelligently' },
  { icon: Code2, title: 'Developer APIs', copy: 'REST + WebSocket integration' },
];

export default function LoginPage() {
  return <main className="min-h-screen bg-white"><div className="grid min-h-screen lg:grid-cols-[minmax(0,1.08fr)_minmax(540px,0.92fr)]">
    <section className="relative hidden overflow-hidden bg-[#170640] px-10 py-10 text-white lg:flex lg:flex-col xl:px-20 xl:py-12">
      <div className="absolute inset-0 opacity-25" style={{ backgroundImage: 'linear-gradient(rgba(184,142,255,.22) 1px, transparent 1px), linear-gradient(90deg, rgba(184,142,255,.22) 1px, transparent 1px)', backgroundSize: '64px 64px' }} />
      <div className="absolute -right-20 top-24 h-72 w-[40rem] rounded-full bg-[#7727f5]/25 blur-3xl" />
      <svg className="absolute left-0 top-[17%] h-[32%] w-full opacity-70" viewBox="0 0 900 300" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="loginWave" x1="0" x2="1"><stop stopColor="#4e29ff" /><stop offset=".58" stopColor="#b650ff" /><stop offset="1" stopColor="#6d2cff" /></linearGradient></defs><path d="M-10 165 C100 55, 175 250, 290 150 S440 90, 515 170 S665 245, 755 110 S875 210, 930 120" fill="none" stroke="url(#loginWave)" strokeWidth="2" /><path d="M-10 190 C105 270, 180 90, 300 180 S470 225, 555 135 S690 42, 770 164 S860 240, 930 200" fill="none" stroke="#9f54ff" strokeOpacity=".5" strokeWidth="1" /></svg>
      <Link href="/" className="relative z-10 inline-flex w-fit items-center" aria-label="PurpleCallio home"><Image src={logo} alt="PurpleCallio" width={228} height={54} className="h-auto w-52 brightness-[1.65] saturate-[.7]" priority /></Link>
      <div className="relative z-10 my-auto max-w-3xl pt-16"><p className="mb-5 text-xs font-semibold tracking-[.28em] text-[#c5a1ff]">VOICE&nbsp;&nbsp;•&nbsp;&nbsp;VIDEO&nbsp;&nbsp;•&nbsp;&nbsp;AI&nbsp;&nbsp;•&nbsp;&nbsp;TRANSLATION</p><h1 className="text-5xl font-bold leading-[1.12] tracking-tight xl:text-6xl">Every conversation.<br /><span className="bg-gradient-to-r from-[#cfaeff] to-[#8e4fff] bg-clip-text text-transparent">One platform.</span></h1><p className="mt-5 max-w-xl text-lg leading-8 text-[#eee8ff]">Real-time voice, video, AI agents and live translation — built for your product.</p><div className="mt-9 grid max-w-3xl grid-cols-2 gap-4">{capabilities.map(({ icon: Icon, title, copy }) => <article key={title} className="group flex min-h-28 items-center gap-4 rounded-2xl border border-[#8150d5]/45 bg-[#4b1d91]/35 p-5 shadow-[inset_0_1px_rgba(255,255,255,.07)] backdrop-blur-sm"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#874bff] to-[#4b16ab] shadow-lg"><Icon size={23} /></span><span className="min-w-0"><b className="block text-[15px]">{title}</b><span className="mt-1 block text-sm leading-5 text-[#ded0fb]">{copy}</span></span><ArrowRight size={18} className="ml-auto shrink-0 text-[#d2b5ff] transition-transform group-hover:translate-x-1" /></article>)}</div></div>
      <div className="relative z-10 flex flex-wrap gap-3 text-sm text-[#eadfff]"><span className="inline-flex items-center gap-2 rounded-full border border-[#8250d0] px-4 py-2"><ShieldCheck size={16} /> Secure by design</span><span className="inline-flex items-center gap-2 rounded-full border border-[#8250d0] px-4 py-2"><Code2 size={16} /> Developer-first</span><span className="inline-flex items-center gap-2 rounded-full border border-[#8250d0] px-4 py-2"><Layers3 size={16} /> Usage-based credits</span></div>
    </section>
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#fefcff] px-5 py-12 sm:px-10"><div className="absolute -bottom-36 -right-32 h-[31rem] w-[45rem] rounded-[50%] border-[48px] border-[#f1e9ff] opacity-80" /><div className="absolute right-[11%] top-[14%] h-12 w-12 rounded-full bg-[#e9d9ff] blur-sm" /><div className="absolute right-[8%] top-[22%] text-5xl tracking-[.18em] text-[#cdaaff]">⌁</div><div className="relative z-10 w-full max-w-md"><AuthCard title="Welcome back" subtitle="Sign in to continue to your workspace." footer={<p className="text-center text-sm text-[#625d81]">New to PurpleCallio? <Link href="/signup" className="font-semibold text-[#7133ee] hover:text-[#5620c9]">Create an account</Link></p>} legal={<p className="mt-7 text-center text-xs text-[#77708f]">By continuing, you agree to our <Link href="/terms" className="font-medium text-[#6425C4]">Terms of Service</Link> and <Link href="/privacy" className="font-medium text-[#6425C4]">Privacy Policy</Link>.</p>} /></div></section>
  </div></main>;
}
