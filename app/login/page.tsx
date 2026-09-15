"use client";
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const router = useRouter();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (res.ok) {
            router.push('/dashboard');
        } else {
            setError('Invalid credentials.');
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-4"
            style={{
                backgroundImage: 'radial-gradient(ellipse at top right, rgba(29, 78, 216, 0.15), transparent 50%), radial-gradient(ellipse at bottom left, rgba(79, 70, 229, 0.15), transparent 50%)',
            }}>

            <div className="w-full max-w-md bg-white/5 backdrop-blur-3xl border border-white/10 rounded-3xl p-8 shadow-2xl">
                <div className="text-center mb-8">
                    <div className="inline-block p-3 rounded-2xl bg-indigo-500/20 text-indigo-400 mb-4">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                        </svg>
                    </div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-500">
                        EntryJobs KE Portal
                    </h1>
                    <p className="text-gray-400 text-sm mt-2 font-medium">Restricted Access Authentication</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-6">
                    {error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl text-center font-medium animate-pulse">
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Username</label>
                        <input
                            type="text"
                            required
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition placeholder-gray-600"
                            placeholder="Identify..."
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Secure Passkey</label>
                        <input
                            type="password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition placeholder-gray-600 tracking-wider"
                            placeholder="••••••••"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-semibold py-3 px-6 rounded-xl shadow-lg transform active:scale-95 transition-all outline-none"
                    >
                        {loading ? 'Authenticating...' : 'Access Neural Core'}
                    </button>
                </form>
            </div>

            <div className="fixed bottom-6 text-center text-xs text-gray-600">
                JobHunter Intelligence Array v1.0 • E2E Encrypted
            </div>
        </div>
    );
}
