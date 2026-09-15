"use client";
import { useEffect, useState } from "react";
import { JobSource } from "@/types/source";

interface ErrorData {
    scrapeErrors: any[];
    degradedSources: any[];
    neverRunSources: any[];
}

export default function AdminPage() {
    const [sources, setSources] = useState<JobSource[]>([]);
    const [settings, setSettings] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isTriggering, setIsTriggering] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [tierFilter, setTierFilter] = useState('all');
    const [errorData, setErrorData] = useState<ErrorData>({ scrapeErrors: [], degradedSources: [], neverRunSources: [] });
    const [isClearing, setIsClearing] = useState(false);

    // Form states for adding/editing source
    const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
    const [newSourceName, setNewSourceName] = useState('');
    const [newSourceUrl, setNewSourceUrl] = useState('');
    const [newSourceKind, setNewSourceKind] = useState('aggregator');
    const [newSourceStrategy, setNewSourceStrategy] = useState('html');
    const [newSourcePriority, setNewSourcePriority] = useState('medium');
    const [newSourceRisk, setNewSourceRisk] = useState('low');
    const [newSourceActive, setNewSourceActive] = useState(true);

    useEffect(() => {
        Promise.all([
            fetch('/api/admin/sources').then(res => res.json()),
            fetch('/api/admin/settings').then(res => res.json()),
            fetch('/api/admin/errors').then(res => res.json())
        ])
            .then(([sourcesData, settingsData, errorsData]) => {
                if (!sourcesData.error) setSources(sourcesData);
                if (!settingsData.error) setSettings(settingsData);
                if (!errorsData.error) setErrorData(errorsData);
            })
            .finally(() => setLoading(false));
    }, []);

    const handleClearErrors = async () => {
        setIsClearing(true);
        try {
            await fetch('/api/admin/errors', { method: 'DELETE' });
            const res = await fetch('/api/admin/errors');
            const data = await res.json();
            if (!data.error) setErrorData(data);
        } finally {
            setIsClearing(false);
        }
    };

    const handleAddOrEditSource = async (e: React.FormEvent) => {
        e.preventDefault();

        const payload = {
            ...(editingSourceId ? { id: editingSourceId } : {}),
            name: newSourceName,
            base_url: newSourceUrl,
            source_kind: newSourceKind,
            strategy: newSourceStrategy,
            priority: newSourcePriority,
            risk_level: newSourceRisk,
            active: newSourceActive,
            // Fallback for legacy scraper support until fully migrated
            type: newSourceStrategy === 'api' ? 'api' : newSourceStrategy === 'rss' ? 'rss' : 'html',
            category: 'Other'
        };

        const method = editingSourceId ? 'PUT' : 'POST';

        const res = await fetch('/api/admin/sources', {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const result = await res.json();
            if (editingSourceId) {
                setSources(sources.map(s => s.id === editingSourceId ? result : s));
            } else {
                setSources([result, ...sources]);
            }
            resetForm();
        }
    };

    const handleDeleteSource = async (id: string) => {
        if (!confirm('Are you sure you want to delete this source? This will stop future tracking.')) return;

        const res = await fetch(`/api/admin/sources?id=${id}`, { method: 'DELETE' });
        if (res.ok) {
            setSources(sources.filter(s => s.id !== id));
        }
    };

    const handleEditClick = (s: JobSource) => {
        setEditingSourceId(s.id);
        setNewSourceName(s.name);
        setNewSourceUrl(s.base_url);
        setNewSourceKind(s.source_kind || 'aggregator');
        setNewSourceStrategy(s.strategy || 'html');
        setNewSourceActive(s.active ?? true);
        setNewSourcePriority(s.priority || 'medium');
        setNewSourceRisk(s.risk_level || 'low');
        window.scrollTo({ top: document.getElementById('source-form')?.offsetTop! - 100, behavior: 'smooth' });
    };

    const resetForm = () => {
        setEditingSourceId(null);
        setNewSourceName('');
        setNewSourceUrl('');
        setNewSourceKind('aggregator');
        setNewSourceStrategy('html');
        setNewSourcePriority('medium');
        setNewSourceRisk('low');
        setNewSourceActive(true);
    };

    const handleSettingChange = async (key: string, value: string) => {
        const res = await fetch('/api/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value })
        });
        if (res.ok) {
            setSettings(settings.map(s => s.key === key ? { ...s, value } : s));
            alert('Setting updated!');
        }
    };

    const handleTriggerScan = async () => {
        setIsTriggering(true);
        try {
            const res = await fetch('/api/admin/trigger', { method: 'POST' });
            const data = await res.json();

            const ingestLine = data.ingestOk
                ? `✅ Ingestion: ${data.ingestData?.message || 'Done'}`
                : `❌ Ingestion FAILED: ${data.ingestData?.error || 'Unknown error'}`;
            const workerLine = data.workerOk
                ? `✅ Worker: ${data.workerData?.message || 'Done'}`
                : `❌ Worker FAILED: ${data.workerData?.error || 'Unknown error'}`;
            const matchLine = data.matchOk
                ? `✅ AI Match: Discovered ${data.matchData?.newHighMatches || 0} New High Matches.`
                : `❌ AI Match FAILED: ${data.matchData?.error || 'Unknown error'}`;

            if (data.success) {
                alert(`✅ Scan complete!\n\n${ingestLine}\n${workerLine}\n${matchLine}`);
            } else {
                alert(`⚠️ Scan finished with errors:\n\n${ingestLine}\n${workerLine}\n${matchLine}`);
            }
        } catch (error) {
            console.error(error);
            alert('Failed to trigger scan.');
        } finally {
            setIsTriggering(false);
        }
    };

    const filteredSources = sources.filter(s => {
        const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.base_url.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesTier = tierFilter === 'all' || s.priority === tierFilter || (s.parsing_config?.priority_level?.toString() === tierFilter);
        return matchesSearch && matchesTier;
    });

    if (loading) return <div className="p-8 text-center mt-20 text-gray-500">Loading admin data...</div>;

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
            <div className="max-w-7xl mx-auto space-y-12">
                <header className="flex justify-between items-start">
                    <div>
                        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white mb-2">Command Center</h1>
                        <p className="text-gray-500 dark:text-gray-400 text-lg">System Settings, AI Thresholds, and Scraper Topology.</p>
                    </div>
                    <a href="/dashboard" className="px-5 py-2.5 bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-white font-semibold rounded-xl hover:opacity-90 transition shadow-sm flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                        Return to Dashboard
                    </a>
                </header>

                {/* Settings Panel */}
                <section className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <h2 className="text-2xl font-semibold mb-6 text-gray-900 dark:text-gray-100">AI Match Thresholds</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {settings.map(setting => (
                            <div key={setting.key} className="space-y-2">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    {setting.key.replace('_', ' ').toUpperCase()}
                                </label>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{setting.description}</p>
                                <div className="flex space-x-2">
                                    <input
                                        type="number"
                                        step="0.01"
                                        defaultValue={setting.value}
                                        className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500"
                                        onBlur={(e) => handleSettingChange(setting.key, e.target.value)}
                                    />
                                    <button
                                        className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md text-sm font-medium"
                                        onClick={(e) => {
                                            const el = e.currentTarget.previousSibling as HTMLInputElement;
                                            handleSettingChange(setting.key, el.value);
                                        }}
                                    >Save</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* ========== SCRAPER ERROR CONSOLE ========== */}
                <section className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                            <span>⚠️</span> Scraper Error Console
                        </h2>
                        <button
                            onClick={handleClearErrors}
                            disabled={isClearing}
                            className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition disabled:opacity-50"
                        >
                            {isClearing ? 'Clearing...' : '🧹 Clear Resolved'}
                        </button>
                    </div>

                    {errorData.scrapeErrors.length === 0 && errorData.degradedSources.length === 0 && errorData.neverRunSources.length === 0 ? (
                        <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl">
                            <span className="text-2xl">✅</span>
                            <div>
                                <p className="text-green-800 dark:text-green-300 font-semibold">All Systems Operational</p>
                                <p className="text-green-600 dark:text-green-400 text-sm">No scraper errors, degraded sources, or unscanned targets detected.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Active Scrape Failures */}
                            {errorData.scrapeErrors.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-bold text-red-600 dark:text-red-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                                        Active Scrape Failures ({errorData.scrapeErrors.length})
                                    </h3>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                            <thead>
                                                <tr>
                                                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Source</th>
                                                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Error</th>
                                                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                                                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Retries</th>
                                                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Time</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                                {errorData.scrapeErrors.map((err: any) => (
                                                    <tr key={err.id}>
                                                        <td className="px-3 py-3 whitespace-nowrap">
                                                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                {err.job_sources?.name || 'Unknown'}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-3">
                                                            <span className="text-sm text-red-600 dark:text-red-400 font-mono break-all max-w-[300px] block truncate" title={err.last_error}>
                                                                {err.last_error || 'No error message'}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-3 whitespace-nowrap">
                                                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                                                                err.status === 'failed'
                                                                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                                                    : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                                            }`}>
                                                                {err.status.toUpperCase()}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500">
                                                            {err.retry_count}/3
                                                        </td>
                                                        <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-400">
                                                            {err.created_at ? new Date(err.created_at).toLocaleString() : 'N/A'}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Degraded / Unhealthy Sources */}
                            {errorData.degradedSources.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                                        Degraded Sources ({errorData.degradedSources.length})
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {errorData.degradedSources.map((src: any) => (
                                            <div key={src.id} className="p-4 bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800/50 rounded-lg">
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                        <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{src.name}</p>
                                                        <p className="text-xs text-gray-500 truncate max-w-[200px]" title={src.base_url}>{src.base_url}</p>
                                                    </div>
                                                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                                                        src.source_health?.status === 'paused'
                                                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                                            : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                                    }`}>
                                                        {src.source_health?.status?.toUpperCase()}
                                                    </span>
                                                </div>
                                                <div className="mt-2 text-xs text-gray-500 space-y-0.5">
                                                    <p>Consecutive Failures: <span className="font-bold text-orange-600">{src.source_health?.consecutive_failures || 0}</span></p>
                                                    {src.source_health?.last_error && (
                                                        <p className="text-red-500 truncate" title={src.source_health.last_error}>Last Error: {src.source_health.last_error}</p>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Never-Run Sources */}
                            {errorData.neverRunSources.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                        Pending First Scan ({errorData.neverRunSources.length})
                                    </h3>
                                    <div className="flex flex-wrap gap-2">
                                        {errorData.neverRunSources.map((src: any) => (
                                            <div key={src.id} className="px-3 py-2 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/50 rounded-lg">
                                                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{src.name}</p>
                                                <p className="text-xs text-blue-500">Added {new Date(src.created_at).toLocaleDateString()} • {src.strategy}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </section>

                {/* Sources Panel */}
                <section className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                    <div id="source-form" className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                            {editingSourceId ? 'Edit Engine Target' : 'Arm New Target'}
                        </h2>
                        {editingSourceId && (
                            <button onClick={resetForm} className="text-sm font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                                Cancel Editing
                            </button>
                        )}
                    </div>

                    <form onSubmit={handleAddOrEditSource} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-8 gap-4 mb-8 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-200 dark:border-gray-700 items-end">
                        <div className="lg:col-span-1 border-r border-gray-200 dark:border-gray-700 pr-4 flex items-center h-full">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Status</span>
                                <input type="checkbox" checked={newSourceActive} onChange={e => setNewSourceActive(e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 bg-white dark:bg-gray-900" />
                            </label>
                        </div>
                        <div className="lg:col-span-1 border-r border-gray-200 dark:border-gray-700 pr-4">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
                            <select value={newSourcePriority} onChange={e => setNewSourcePriority(e.target.value)} className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 text-sm">
                                <option value="core">🟢 Core</option>
                                <option value="high">🔵 High</option>
                                <option value="medium">🟡 Medium</option>
                                <option value="low">⚪ Low</option>
                            </select>
                        </div>
                        <div className="lg:col-span-2">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Source Name</label>
                            <input required value={newSourceName} onChange={e => setNewSourceName(e.target.value)} type="text" className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 text-sm" placeholder="e.g. Fuzu" />
                        </div>
                        <div className="lg:col-span-2">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Base URL</label>
                            <input required value={newSourceUrl} onChange={e => setNewSourceUrl(e.target.value)} type="url" className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 text-sm" placeholder="https://" />
                        </div>
                        <div className="lg:col-span-1">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Strategy</label>
                            <select value={newSourceStrategy} onChange={e => setNewSourceStrategy(e.target.value)} className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 text-sm">
                                <optgroup label="Standard">
                                    <option value="html">HTML (Fetch)</option>
                                    <option value="proxy_html">Proxy (Anti-bot)</option>
                                    <option value="browser">Browser (JS)</option>
                                    <option value="api">API</option>
                                    <option value="rss">RSS</option>
                                </optgroup>
                                <optgroup label="ATS Engines">
                                    <option value="ats_bamboohr">BambooHR</option>
                                    <option value="ats_zoho">Zoho Recruit</option>
                                    <option value="ats_csod">CSOD</option>
                                    <option value="ats_mci">MCI</option>
                                </optgroup>
                            </select>
                        </div>
                        <div className="lg:col-span-1 flex items-end">
                            <button type="submit" className={`w-full py-2 ${editingSourceId ? 'bg-orange-500 hover:bg-orange-600' : 'bg-blue-600 hover:bg-blue-700'} text-white rounded-md font-medium text-sm transition h-[38px] shadow-sm`}>
                                {editingSourceId ? 'Save' : 'Add'}
                            </button>
                        </div>
                    </form>

                    <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
                        <div className="flex gap-4 w-full md:w-auto">
                            <input
                                type="text"
                                placeholder="Search Source Name or URL..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full md:w-64 rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-blue-500"
                            />
                            <select
                                value={tierFilter}
                                onChange={e => setTierFilter(e.target.value)}
                                className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="all">All Priorities</option>
                                <option value="core">🟢 Core</option>
                                <option value="high">🔵 High</option>
                                <option value="medium">🟡 Medium</option>
                                <option value="low">⚪ Low</option>
                            </select>
                        </div>
                        <button
                            onClick={handleTriggerScan}
                            disabled={isTriggering}
                            className="w-full md:w-auto px-6 py-2.5 bg-black dark:bg-white text-white dark:text-black font-semibold rounded-lg hover:opacity-90 transition shadow-sm disabled:opacity-50"
                        >
                            {isTriggering ? 'Running Scan... Please wait' : '🛠️ Force AI Scan Now'}
                        </button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead>
                                <tr>
                                    <th className="px-4 py-3 text-left leading-4 text-gray-500 tracking-wider text-xs uppercase font-bold">Source</th>
                                    <th className="px-4 py-3 text-left leading-4 text-gray-500 tracking-wider text-xs uppercase font-bold">Priority</th>
                                    <th className="px-4 py-3 text-left leading-4 text-gray-500 tracking-wider text-xs uppercase font-bold">Strategy</th>
                                    <th className="px-4 py-3 text-left leading-4 text-gray-500 tracking-wider text-xs uppercase font-bold">Health</th>
                                    <th className="px-4 py-3 text-left leading-4 text-gray-500 tracking-wider text-xs uppercase font-bold">Last Run</th>
                                    <th className="px-4 py-3 text-right leading-4 text-gray-500 tracking-wider text-xs uppercase font-bold">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                {filteredSources.map(s => (
                                    <tr key={s.id} className={!s.active ? 'opacity-50' : ''}>
                                        <td className="px-4 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
                                                {s.name}
                                                <a href={s.base_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 dark:text-blue-400 hover:underline inline-block" title="Visit Source">↗</a>
                                            </div>
                                            <div className="text-xs text-gray-500 max-w-[250px] truncate" title={s.base_url}>{s.base_url}</div>
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap text-sm font-bold text-gray-600 dark:text-gray-300">
                                            {s.priority === 'core' && <span className="text-green-600">🟢 Core</span>}
                                            {s.priority === 'high' && <span className="text-blue-600">🔵 High</span>}
                                            {s.priority === 'medium' && <span className="text-yellow-600">🟡 Medium</span>}
                                            {s.priority === 'low' && <span className="text-gray-500">⚪ Low</span>}
                                            {!s.priority && <span className="text-gray-400">Legacy Tier {s.parsing_config?.priority_level}</span>}
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap">
                                            <span className="px-2.5 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-md text-xs font-medium border border-gray-200 dark:border-gray-700">
                                                {s.strategy || s.type}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap">
                                            {s.source_health ? (
                                                <div className="flex flex-col">
                                                    <span className={`text-xs font-semibold ${
                                                        s.source_health.status === 'degraded' ? 'text-orange-500' :
                                                        s.source_health.status === 'paused' ? 'text-red-500' : 'text-green-500'
                                                    }`}>
                                                        {s.source_health.status?.toUpperCase() || 'UNKNOWN'}
                                                    </span>
                                                    <span className="text-[10px] text-gray-400">Avg: {s.source_health.avg_response_ms || 0}ms | Fails: {s.source_health.consecutive_failures || 0}</span>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-gray-400">No Data</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap text-xs text-gray-500">
                                            {s.last_run_at ? new Date(s.last_run_at).toLocaleString() : 'Never'}
                                            {s.source_health?.jobs_found_last_run !== undefined && (
                                                <div className="text-[10px] text-blue-500 font-medium">Found: {s.source_health.jobs_found_last_run}</div>
                                            )}
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <button onClick={() => handleEditClick(s)} className="text-orange-600 hover:text-orange-900 dark:text-orange-400 dark:hover:text-orange-300 mr-4">Edit</button>
                                            <button onClick={() => handleDeleteSource(s.id)} className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300">Delete</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </div>
    );
}
