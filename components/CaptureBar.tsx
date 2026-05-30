'use client';

import React, { useEffect, useRef, useState } from 'react';

type Props = {
  onSubmit: (text: string) => void | Promise<void>;
  busy: boolean;
};

export default function CaptureBar({ onSubmit, busy }: Props) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recRef = useRef<any>(null);

  // Decide voice support after mount to avoid an SSR/client hydration mismatch.
  useEffect(() => {
    const w = window as any;
    setVoiceSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    void onSubmit(t);
    setText('');
  };

  const toggleVoice = () => {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e: any) => {
      let s = '';
      for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
      setText(s);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  return (
    <div className="flex items-end gap-2 rounded-2xl border border-gray-200 bg-white/95 p-2 shadow-lg backdrop-blur">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder={'Add anyone — e.g. "Ada lives in Lisbon"'}
        className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-gray-400"
      />
      {voiceSupported && (
        <button
          type="button"
          onClick={toggleVoice}
          title="Dictate"
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg transition-colors ${
            listening ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          🎤
        </button>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={busy || !text.trim()}
        className="h-10 shrink-0 rounded-xl bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? 'Reading…' : 'Add'}
      </button>
    </div>
  );
}
