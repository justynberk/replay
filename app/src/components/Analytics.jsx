import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowClockwise, ArrowRight, ChartBar, CaretDown, CheckCircle, Clock, DownloadSimple, Eye, FilmStrip, MagnifyingGlass, Play, Users, X } from '@phosphor-icons/react';
import { api, time } from '../lib.js';
import { Spinner } from './UI.jsx';
import './analytics.css';

export function watchTime(seconds = 0) {
  if (seconds > 0 && seconds < 1) return '<1s';
  const value = Math.floor(seconds);
  if (value >= 3600) return `${Math.floor(value / 3600)}h ${Math.floor(value % 3600 / 60)}m`;
  if (value >= 60) return `${Math.floor(value / 60)}m ${value % 60}s`;
  return `${value}s`;
}
const count = value => value.toLocaleString();
const percent = value => `${Math.round(value * 100)}%`;
const labelDate = date => new Date(date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function Analytics({ onOpen, onWatch, assets }) {
  const [days, setDays] = useState('30'), [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState(''), [sort, setSort] = useState('views'), [metric, setMetric] = useState('views'), [selected, setSelected] = useState(null), [hovered, setHovered] = useState(null);
  const detailElement = useRef();
  useEffect(() => { if (selected) detailElement.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); }, [selected]);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(() => {
    let cancelled = false, active = false;
    setLoading(true); setError(''); setData(null); setHovered(null);
    async function refresh() {
      if (active) return;
      active = true;
      try { const result = await api(`/analytics?days=${days}&timeZone=${encodeURIComponent(timeZone)}`); if (!cancelled) { setData(result); setError(''); } }
      catch (err) { if (!cancelled) setError(err.message); }
      finally { active = false; if (!cancelled) setLoading(false); }
    }
    refresh();
    const interval = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [days, attempt, timeZone]);
  const visible = useMemo(() => (data?.content || []).filter(row => row.title.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b[sort] - a[sort] || a.title.localeCompare(b.title)), [data, query, sort]);
  const detail = data?.content.find(row => row.assetId === selected);
  const max = Math.max(1, ...(data?.daily || []).map(d => d[metric]));
  const focusDay = data?.daily[hovered];
  const downloadUrl = `/api/analytics/export.csv?${new URLSearchParams({ days, timeZone, query, sort })}`;
  const launch = row => { const asset = assets.find(a => a.id === row.assetId); if (asset) onWatch(asset); };
  return <main className="library-main analytics-main">
    <div className="library-topline"><span>WORKSPACE / <strong>ANALYTICS</strong></span><div className="library-local-indicator"><span /> Local viewing activity</div></div>
    <header className="library-header"><div><h1>Analytics</h1><p>See what gets watched. Find what holds attention.</p></div><div className="analytics-actions"><label><span className="library-sr-only">Analytics date range</span><select value={days} onChange={e => setDays(e.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>{data && visible.length ? <a className="button" href={downloadUrl} download><DownloadSimple size={17} />Export CSV</a> : <button className="button" disabled><DownloadSimple size={17} />Export CSV</button>}<button className="icon-button" aria-label="Refresh analytics" onClick={() => setAttempt(n => n + 1)} disabled={loading}><ArrowClockwise size={19} /></button></div></header>
    {error && <div className="analytics-error" role="alert">{data ? 'These numbers may be out of date. ' : 'Analytics could not be loaded. '}{error}<button onClick={() => setAttempt(n => n + 1)}>Try again</button></div>}
    {loading && !data && <div className="analytics-loading"><Spinner>Loading viewing activity</Spinner></div>}
    {data && <>
      <div className="analytics-metrics">
        {[
          [Eye, 'Views', count(data.totals.views), <><Users size={14} />{count(data.totals.uniqueViewers)} unique {data.totals.uniqueViewers === 1 ? 'browser' : 'browsers'}</>],
          [Clock, 'Watch time', watchTime(data.totals.watchSeconds), <><Play size={14} />{data.totals.views ? `${watchTime(data.totals.averageWatchSeconds)} average per view` : 'Average available after the first view'}</>],
          [CheckCircle, 'Completion', data.totals.views ? percent(data.totals.completionRate) : 'No views', 'Views that watched at least 90%'],
        ].map(([Icon, title, value, hint]) => <section className="analytics-metric" key={title}><div><span>{title}</span><Icon size={20} /></div><strong className={value === 'No views' ? 'is-empty' : undefined}>{value}</strong><small>{hint}</small></section>)}
      </div>
      <section className="analytics-panel analytics-activity"><div className="analytics-panel-heading"><div><h2>Viewing activity</h2><p>{labelDate(data.from)} to {labelDate(data.to)} · {data.timeZone}</p></div><div className="analytics-switch" aria-label="Activity metric"><button className={metric === 'views' ? 'active' : ''} aria-pressed={metric === 'views'} onClick={() => setMetric('views')}>Views</button><button className={metric === 'watchSeconds' ? 'active' : ''} aria-pressed={metric === 'watchSeconds'} onClick={() => setMetric('watchSeconds')}>Watch time</button></div></div>
        <div className="analytics-chart-readout" aria-live="polite">{focusDay ? `${labelDate(focusDay.date)} · ${metric === 'views' ? `${count(focusDay.views)} views` : watchTime(focusDay.watchSeconds)}` : data.totals.views ? 'Select a day to explore' : 'No views in this period yet'}</div>
        <div className="analytics-chart"><div className="analytics-chart-scale"><span>{metric === 'views' ? count(max) : watchTime(max)}</span><span>0</span></div><div className="analytics-bars" onMouseLeave={() => setHovered(null)}>{data.daily.map((day, i) => <button key={day.date} onMouseEnter={() => setHovered(i)} onFocus={() => setHovered(i)} onBlur={() => setHovered(null)} aria-label={`${labelDate(day.date)}: ${day.views} views, ${watchTime(day.watchSeconds)} watched`} className={hovered === i ? 'selected' : ''}><span style={{ height: `${day[metric] / max * 100}%`, minHeight: day[metric] > 0 ? 3 : 0 }} /></button>)}</div></div>
        <div className="analytics-chart-dates"><span>{labelDate(data.from)}</span><span>{labelDate(data.daily[Math.floor(data.daily.length / 2)].date)}</span><span>{labelDate(data.to)}</span></div>
      </section>
      {!data.totals.views && <div className="analytics-get-started"><span className="analytics-empty-icon"><ChartBar size={25} /></span><div><h3>Your next play starts the story</h3><p>Open a recording’s watch page and press play to start collecting activity. Editor previews and downloaded files are excluded.</p></div>{assets.some(a => !a.archived) && <button className="button" onClick={() => onWatch(assets.find(a => !a.archived))}>Open a watch page<ArrowRight size={17} /></button>}</div>}
      <section className="analytics-panel"><div className="analytics-panel-heading analytics-content-heading"><div><h2>Content performance</h2><p>{visible.length} recording{visible.length === 1 ? '' : 's'} · Select a title for viewing details</p></div><div className="analytics-table-tools"><label className="analytics-search"><MagnifyingGlass size={16} /><input aria-label="Search analytics recordings" placeholder="Find a recording..." value={query} onChange={e => setQuery(e.target.value)} /></label><label><span className="library-sr-only">Sort analytics</span><select value={sort} onChange={e => setSort(e.target.value)}><option value="views">Most viewed</option><option value="watchSeconds">Most watch time</option><option value="completionRate">Highest completion</option></select></label></div></div>
        <div className="analytics-table-scroll"><table className="analytics-table"><thead><tr><th>Recording</th><th>Views</th><th>Watch time</th><th>Avg. watch</th><th>Completion</th><th><span className="library-sr-only">Watch page</span></th></tr></thead><tbody>{visible.map(row => <tr key={row.assetId} className={selected === row.assetId ? 'selected' : ''}><td><button className="analytics-recording" onClick={() => setSelected(row.assetId)} aria-expanded={selected === row.assetId}><span className="analytics-thumbnail">{row.thumbnailUrl ? <img src={row.thumbnailUrl} alt="" loading="lazy" /> : <FilmStrip size={21} />}</span><span><strong>{row.title}</strong><small>{time(row.duration)}{row.sample ? ' · Sample content' : ''}{row.archived ? ' · Archived' : ''}</small></span></button></td><td>{count(row.views)}</td><td>{watchTime(row.watchSeconds)}</td><td>{row.views ? watchTime(row.averageWatchSeconds) : 'No views'}</td><td><div className="analytics-completion">{row.views ? percent(row.completionRate) : 'No views'}<span><i style={{ width: `${row.completionRate * 100}%` }} /></span></div></td><td><button className="icon-button" aria-label={`Watch ${row.title}`} onClick={() => launch(row)}><Play size={18} /></button></td></tr>)}</tbody></table></div>
        {!visible.length && <div className="analytics-table-empty">{query ? 'No recordings match your search.' : 'Record or import your first video to see it here.'}</div>}
      </section>
      {detail && <section ref={detailElement} className="analytics-panel analytics-detail" aria-label={`Viewing details for ${detail.title}`}><div className="analytics-panel-heading"><div><p>RECORDING DETAILS</p><h2>{detail.title}</h2></div><div className="analytics-actions"><button className="button" onClick={() => launch(detail)}><Play size={16} />Watch</button><button className="icon-button" aria-label="Close viewing details" onClick={() => setSelected(null)}><X size={19} /></button></div></div><div className="analytics-detail-body"><div><h3>Audience coverage</h3><p>Average share watched in each part of the video. Replays count once; skipped sections stay empty.</p><div className="analytics-retention" role="img" aria-label={detail.views ? detail.retention.map(r => `${Math.round(r.start * 100)} to ${Math.round(r.end * 100)} percent of video: ${percent(r.value)} watched`).join(', ') : 'No viewing data yet'}>{detail.retention.map((r, i) => <div key={i} title={`${Math.round(r.start * 100)} to ${Math.round(r.end * 100)}% of video: ${percent(r.value)} watched`}><span style={{ height: `${r.value * 100}%` }} /></div>)}</div><div className="analytics-retention-labels"><span>Start</span><span>50%</span><span>End</span></div><div className="analytics-detail-summary"><strong>{detail.views ? percent(detail.averageCoverage) : 'No views'}</strong><span>Average video watched</span><strong>{detail.uniqueViewers}</strong><span>Unique browsers</span></div></div><div><h3>Recent viewing sessions</h3><p>Latest 10 sessions in this date range.</p>{detail.recent.length ? <ul className="analytics-sessions">{detail.recent.map(s => <li key={s.id}><span>{new Date(s.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span><strong>{watchTime(s.watchSeconds)}</strong><small>{s.completed ? 'Completed' : `${percent(s.coverage)} watched`}</small></li>)}</ul> : <p className="analytics-no-sessions">No one has played this watch page yet.</p>}<button className="text-link" onClick={() => onOpen(assets.find(a => a.id === detail.assetId))}>Open in editor<ArrowRight size={14} /></button></div></div></section>}
      <footer className="analytics-footnote"><div className="analytics-measurement-summary"><p><strong>Measured on this computer.</strong> Local watch-page activity only.</p><span>Updated {new Date(data.generatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · Refreshes every 15s</span></div><details><summary>How measurement works<CaretDown size={14} /></summary><p>A view starts when a local watch page plays. Pauses, buffering, hidden tabs and seeking add no watch time. A session lasts until the watch page closes or reloads; replaying adds time to that session. Unique browsers are anonymous browser identities and reset when site storage is cleared. All session activity is grouped by its start date. Review and editor previews, exported files and views on other platforms are excluded.</p></details></footer>
    </>}
  </main>;
}
