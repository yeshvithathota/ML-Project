import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowDownRight, ArrowUpRight, BarChart3, BrainCircuit, Check, ChevronDown, CircleHelp, Database, FileUp, Gauge, Layers3, LoaderCircle, Menu, RotateCcw, Sparkles, Target, Upload, Users, X } from 'lucide-react'

const API = `${import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'}/api`
const palette = ['#a1394a', '#829888', '#c8aa84', '#bd7a73', '#657d6d']
const pretty = (n) => n.replaceAll('_', ' ').replace(/\b\w/g, x => x.toUpperCase())
const pct = (v) => `${(v * 100).toFixed(1)}%`

export default function App() {
  const [auth, setAuth] = useState(() => { try { return JSON.parse(localStorage.getItem('customerLensAuth') || 'null') } catch { return null } })
  const [page, setPage] = useState('Overview')
  const [menuOpen, setMenuOpen] = useState(false)
  const [status, setStatus] = useState({ ready: false, classes: [], features: [] })
  const [data, setData] = useState(null)
  const [form, setForm] = useState({})
  const [prediction, setPrediction] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [dragging, setDragging] = useState(false)
  const uploadRef = useRef(null)

  async function refresh() {
    try {
      const headers = { Authorization: `Bearer ${auth?.token}` }
      const [s, a] = await Promise.all([fetch(`${API}/status`, { headers }), fetch(`${API}/analytics`, { headers })])
      if (s.status === 401 || a.status === 401) { signOut(); return }
      const nextStatus = await s.json()
      setStatus(nextStatus)
      setData(await a.json())
    } catch {
      setStatus({ ready: false, classes: [], features: [], error: 'API is offline. Start the Python API in the second terminal.' })
    }
  }
  useEffect(() => { if (auth?.token) refresh() }, [auth?.token])
  useEffect(() => {
    const next = {}
    status.features?.forEach(f => { next[f.name] = f.type === 'number' ? '' : (f.choices?.[0] ?? '') })
    setForm(next)
  }, [status.features])

  const totalSegments = useMemo(() => data?.segments?.reduce((a, b) => a + b.count, 0) || 0, [data])
  function signOut() { localStorage.removeItem('customerLensAuth'); setAuth(null); setData(null); setPrediction(null) }
  const nav = [
    { label: 'Overview', icon: BarChart3 },
    { label: 'Make a prediction', icon: Sparkles },
    { label: 'Model & method', icon: BrainCircuit },
  ]

  async function handleUpload(file) {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) { setNotice('Please choose a .csv file. Excel workbooks need to be saved as CSV first.'); return }
    if (file.size > 50 * 1024 * 1024) { setNotice('This file is over the 50 MB upload limit.'); return }
    setBusy(true); setNotice('Training the model from your CSV…')
    const body = new FormData(); body.append('file', file)
    try {
      const res = await fetch(`${API}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${auth?.token}` }, body })
      const json = await res.json()
      if (!res.ok) throw new Error(json.detail || 'Could not train from this CSV.')
      setNotice(`Model trained from ${json.rows.toLocaleString()} rows.`); await refresh()
    } catch (e) { setNotice(e.message) } finally { setBusy(false); if (uploadRef.current) uploadRef.current.value = '' }
  }

  async function submitPrediction(e) {
    e.preventDefault(); setBusy(true); setPrediction(null); setNotice('')
    const values = {}
    status.features.forEach(f => { values[f.name] = f.type === 'number' ? (form[f.name] === '' ? null : Number(form[f.name])) : form[f.name] })
    try {
      const res = await fetch(`${API}/predict`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth?.token}` }, body: JSON.stringify({ values }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.detail || 'Prediction failed.')
      setPrediction(json)
    } catch (e) { setNotice(e.message) } finally { setBusy(false) }
  }

  if (!auth?.token) return <LoginPage onLogin={setAuth}/>
  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Layers3 size={19} /></div><div><b>customer<span>lens</span></b><small>ML WORKSPACE</small></div><button className="icon-btn close-menu" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={18}/></button></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>{nav.map(({ label, icon: Icon }) => <button key={label} onClick={() => { setPage(label); setMenuOpen(false) }} className={`nav-item ${page === label ? 'active' : ''}`}><Icon size={17}/><span>{label}</span>{page === label && <span className="nav-dot"/>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="side-project"><div className="project-icon"><Target size={17}/></div><div><b>Customer segments</b><small>Multiclass classification</small></div><ChevronDown size={15}/></div><div className="side-help"><CircleHelp size={16}/><span>About this project</span></div><div className="profile"><div className="avatar">{auth.role === 'admin' ? 'AD' : 'US'}</div><div><b>{auth.username}</b><small>{pretty(auth.role)} access</small></div><button className="logout-link" onClick={signOut}>Sign out</button></div></div>
    </aside>
    {menuOpen && <button className="scrim" onClick={() => setMenuOpen(false)} aria-label="Close navigation"/>}
    <main className="main-area">
      <header className="topbar"><button className="icon-btn mobile-menu" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu size={20}/></button><div className="breadcrumbs">Projects <span>/</span> Customer category prediction <span>/</span> <b>{page}</b></div><div className="top-actions"><span className={`status-pill ${status.ready ? 'is-ready' : ''}`}><i/>{status.ready ? 'Model ready' : 'Model not trained'}</span><button className="upload-top" disabled={busy} onClick={() => uploadRef.current?.click()}>{busy ? <LoaderCircle className="spin" size={15}/> : <Upload size={15}/>}<span>{busy ? 'Reading CSV…' : 'Upload CSV'}</span></button><input ref={uploadRef} type="file" accept=".csv,text/csv" hidden onChange={e => handleUpload(e.target.files?.[0])}/></div></header>
      <div className="content page-view" key={page}>
        {page === 'Overview' && <>
          <div className="page-heading"><div><div className="eyebrow"><Activity size={14}/> CUSTOMER INTELLIGENCE</div><h1>Customer category <em>prediction</em></h1><p>Understand customer segments with an interpretable machine learning model.</p></div><button className="primary-button" onClick={() => setPage('Make a prediction')}><Sparkles size={16}/> Make a prediction</button></div>
          {!status.ready && <div className={`empty-banner csv-dropzone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); handleUpload(e.dataTransfer.files?.[0]) }}><div className="empty-icon"><Database size={20}/></div><div className="empty-copy"><b>Drop your customer CSV here</b><span>or browse for a file · CSV up to 50 MB. The app can read target columns named <code>customer_segment</code>, <code>Customer Category</code>, <code>segment</code>, or <code>category</code>.</span></div><button className="outline-button" disabled={busy} onClick={() => uploadRef.current?.click()}>{busy ? <LoaderCircle className="spin" size={15}/> : <FileUp size={15}/>} {busy ? 'Reading CSV…' : 'Browse CSV'}</button></div>}
          {notice && <div className="notice"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15}/></button></div>}
          <div className="section-label"><span>MODEL SNAPSHOT</span><small>{status.ready ? `${data?.metrics?.test_count?.toLocaleString() || 0} holdout records` : 'Waiting for your dataset'}</small></div>
          <div className="metric-grid">
            <Metric title="Test accuracy" value={data?.metrics ? pct(data.metrics.accuracy) : '—'} detail="Correct predictions" icon={Target} color="green"/>
            <Metric title="Weighted F1 score" value={data?.metrics ? pct(data.metrics.f1) : '—'} detail="Precision + recall balance" icon={Gauge} color="amber"/>
            <Metric title="Customers analyzed" value={status.ready ? status.rows.toLocaleString() : '—'} detail="After data cleaning" icon={Users} color="blue"/>
            <Metric title="Customer segments" value={status.ready ? status.classes.length : '4'} detail={status.ready ? status.classes.map(pretty).join(' · ') : 'Occasional · Regular · Loyal · High Value'} icon={Layers3} color="violet"/>
          </div>
          <div className="dashboard-grid">
            <section className="card distribution-card"><div className="card-heading"><div><span className="card-kicker">CUSTOMER MIX</span><h2>Segment distribution</h2></div><span className="subtle-tag">{totalSegments ? `${totalSegments.toLocaleString()} customers` : 'Dataset preview'}</span></div>
              {data?.segments?.length ? <div className="distribution-list">{data.segments.map((s, i) => <div className="segment-row" key={s.name}><div className="segment-line"><span className="segment-name"><i style={{ background: palette[i % palette.length] }}/>{pretty(s.name)}</span><b>{s.count.toLocaleString()}</b><span className="segment-percent">{(s.count / totalSegments * 100).toFixed(1)}%</span></div><div className="track"><span style={{ width: `${s.count / totalSegments * 100}%`, background: palette[i % palette.length] }}/></div></div>)}</div> : <div className="chart-empty"><div className="bar-placeholder"><i/><i/><i/><i/></div><b>Segment counts will appear here</b><span>Distribution is calculated from your uploaded dataset.</span></div>}
              <div className="card-foot"><span>Target variable</span><code>customer_segment</code></div>
            </section>
            <section className="card evaluation-card"><div className="card-heading"><div><span className="card-kicker">HOLDOUT EVALUATION</span><h2>How the model performs</h2></div><span className="score-chip"><span>F1</span> {data?.metrics ? pct(data.metrics.f1) : '—'}</span></div>
              {data?.metrics ? <><div className="evaluation-bars"><Score label="Precision" value={data.metrics.precision}/><Score label="Recall" value={data.metrics.recall}/><Score label="Accuracy" value={data.metrics.accuracy}/></div><div className="evaluation-note"><span className="note-icon"><Activity size={15}/></span><span>Metrics use a stratified 80/20 test split. Weighted scores reflect class size.</span></div></> : <div className="chart-empty evaluation-empty"><div className="mini-chart"><span/><span/><span/><span/><span/></div><b>Evaluation after training</b><span>Precision, recall, F1 and accuracy will be calculated on held-out records.</span></div>}
            </section>
          </div>
          <section className="card confusion-card"><div className="card-heading"><div><span className="card-kicker">CLASS LEVEL DETAIL</span><h2>Classification report</h2></div><span className="subtle-tag">Per-segment performance</span></div>
            {data?.class_metrics?.length ? <div className="table-wrap"><table><thead><tr><th>CUSTOMER SEGMENT</th><th>PRECISION</th><th>RECALL</th><th>F1 SCORE</th><th>TEST RECORDS</th></tr></thead><tbody>{data.class_metrics.map((r, i) => <tr key={r.name}><td><span className="table-segment"><i style={{ background: palette[i % palette.length] }}/>{pretty(r.name)}</span></td><td>{pct(r.precision)}</td><td>{pct(r.recall)}</td><td><b>{pct(r.f1)}</b></td><td>{r.support.toLocaleString()}</td></tr>)}</tbody></table></div> : <div className="table-placeholder"><span>Upload the dataset to see precision, recall and F1 for each customer segment.</span></div>}
          </section>
          {data?.confusion && <section className="card confusion-card"><div className="card-heading"><div><span className="card-kicker">ACTUAL VS PREDICTED</span><h2>Confusion matrix</h2></div><span className="subtle-tag">Rows are actual · columns are predicted</span></div><ConfusionMatrix data={data.confusion}/></section>}
          <footer>Customer Lens <span>·</span> Multinomial Logistic Regression <span>·</span> Built for customer understanding</footer>
        </>}
        {page === 'Make a prediction' && <PredictionPage status={status} form={form} setForm={setForm} submit={submitPrediction} prediction={prediction} busy={busy} notice={notice} setNotice={setNotice} upload={() => uploadRef.current?.click()}/>}
        {page === 'Model & method' && <MethodPage status={status} data={data}/>}
      </div>
    </main>
  </div>
}

function LoginPage({ onLogin }) {
  const [role, setRole] = useState('user')
  const [view, setView] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      if (view === 'signup' && password !== confirmPassword) throw new Error('The passwords do not match.')
      const res = await fetch(`${API}/${view === 'signup' ? 'signup' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
      const result = await res.json()
      if (!res.ok) throw new Error(result.detail || (view === 'signup' ? 'Could not create your account.' : 'Could not sign in.'))
      if (view === 'login' && result.role !== role) throw new Error(`These credentials belong to the ${result.role} account. Choose the matching sign-in tab.`)
      localStorage.setItem('customerLensAuth', JSON.stringify(result)); onLogin(result)
    } catch (e) { setError(e.message.includes('Failed to fetch') ? 'The Python API is offline. Start it in a VS Code terminal, then try again.' : e.message) }
    finally { setBusy(false) }
  }
  const signup = view === 'signup'
  return <div className="login-shell"><div className="login-art"><div className="login-art-brand"><div className="brand-mark"><Layers3 size={19}/></div><b>customer<span>lens</span></b></div><div className="art-copy"><span className="eyebrow"><Activity size={14}/> CUSTOMER INTELLIGENCE</span><h1>See your customers<br/>in a <em>new light.</em></h1><p>Machine learning insights that help you understand the people behind every purchase.</p><div className="art-chart"><div className="art-chart-head"><span>SEGMENT SIGNAL</span><span>LIVE MODEL</span></div><div className="art-bars"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div><div className="art-chart-legend"><span><i/>Occasional</span><span><i/>Regular</span><span><i/>Loyal</span><span><i/>High Value</span></div></div></div><div className="art-bottom">MULTI-CLASS CUSTOMER CATEGORY PREDICTION <span>·</span> LOGISTIC REGRESSION</div></div><div className="login-panel"><div className="login-mobile-brand"><div className="brand-mark"><Layers3 size={19}/></div><b>customer<span>lens</span></b></div><div className="login-form-wrap"><div className="eyebrow"><span className="login-eyebrow-dot"/> {signup ? 'CREATE YOUR ACCOUNT' : 'SECURE WORKSPACE'}</div><h2>{signup ? 'Join Customer Lens' : 'Welcome back'}</h2><p className="login-subtitle">{signup ? 'Create a User account to explore customer insights.' : 'Sign in to continue to your customer workspace.'}</p>{!signup ? <div className="role-switch"><button className={role === 'user' ? 'selected' : ''} onClick={() => { setRole('user'); setError('') }} type="button"><Users size={15}/> User</button><button className={role === 'admin' ? 'selected' : ''} onClick={() => { setRole('admin'); setError('') }} type="button"><Layers3 size={15}/> Admin</button></div> : <div className="signup-role"><Users size={15}/> New accounts receive User access</div>}<form onSubmit={submit} className="login-form"><label className="field"><span>Username</span><input autoComplete="username" minLength={3} maxLength={32} required value={username} onChange={e => setUsername(e.target.value)} placeholder={signup ? 'Choose a username' : role === 'admin' ? 'Admin username' : 'Your username'}/></label><label className="field"><span>Password</span><input autoComplete={signup ? 'new-password' : 'current-password'} minLength={signup ? 10 : undefined} required type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={signup ? 'At least 10 characters' : 'Enter your password'}/></label>{signup && <label className="field"><span>Confirm password</span><input autoComplete="new-password" minLength={10} required type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Enter the same password again"/></label>}{error && <div className="login-error">{error}</div>}<button disabled={busy} className="primary-button login-submit">{busy ? <LoaderCircle className="spin" size={16}/> : null}{busy ? (signup ? 'Creating account…' : 'Signing in…') : signup ? 'Create User account' : `Sign in as ${pretty(role)}`}</button></form><div className="auth-switch-link">{signup ? <>Already registered? <button type="button" onClick={() => { setView('login'); setError('') }}>Sign in</button></> : <>New to Customer Lens? <button type="button" onClick={() => { setView('signup'); setRole('user'); setError('') }}>Create a User account</button></>}</div><div className="login-note"><span className="lock-mark">⌑</span> {signup ? 'Admin permissions are only assigned by the project owner.' : 'Your workspace credentials stay private.'}</div></div><div className="login-panel-foot">CUSTOMER LENS <span>·</span> MODEL-POWERED SEGMENTATION</div></div></div>
}

function Metric({ title, value, detail, icon: Icon, color }) { return <div className="metric-card"><div className={`metric-icon ${color}`}><Icon size={17}/></div><div className="metric-title">{title}</div><strong><AnimatedValue value={value}/></strong><div className="metric-detail">{detail}</div></div> }
function AnimatedValue({ value }) {
  const [shown, setShown] = useState(String(value))
  useEffect(() => {
    const text = String(value)
    const target = Number(text.replaceAll(',', '').replace('%', ''))
    if (!Number.isFinite(target)) { setShown(text); return }
    const isPercent = text.endsWith('%')
    const start = performance.now()
    let frame
    const tick = (now) => {
      const progress = Math.min((now - start) / 720, 1)
      const eased = 1 - (1 - progress) ** 4
      const current = target * eased
      setShown(`${isPercent ? current.toFixed(1) : Math.round(current).toLocaleString()}${isPercent ? '%' : ''}`)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return <>{shown}</>
}
function Score({ label, value }) { return <div className="score-row"><div><span>{label}</span><b>{pct(value)}</b></div><div className="track"><span style={{ width: `${value * 100}%` }}/></div></div> }
function ConfusionMatrix({ data }) { const max = Math.max(...data.matrix.flat(), 1); return <div className="matrix-wrap"><div className="matrix-title">Predicted category →</div><div className="matrix-grid"><div/><div className="matrix-col-labels">{data.labels.map(l => <span key={l}>{pretty(l)}</span>)}</div>{data.matrix.map((row, ri) => <div className="matrix-row" key={data.labels[ri]}><b>{pretty(data.labels[ri])}</b>{row.map((v, ci) => <span key={ci} className={ri === ci ? 'matrix-diagonal' : ''} style={{ background: `rgba(82,107,89,${.07 + .75 * v / max})` }}>{v.toLocaleString()}</span>)}</div>)}</div><div className="matrix-y-label">Actual category ↓</div></div> }

function PredictionPage({ status, form, setForm, submit, prediction, busy, notice, setNotice, upload }) {
  if (!status.ready) return <><div className="page-heading"><div><div className="eyebrow"><Sparkles size={14}/> LIVE CLASSIFICATION</div><h1>Make a <em>prediction</em></h1><p>Enter a customer's details to estimate their category.</p></div></div><div className="prediction-blocked"><div className="empty-icon large"><Database size={25}/></div><h2>Train the model to get started</h2><p>{upload ? 'Upload your customer CSV first. The model will learn from that data using your project’s Logistic Regression pipeline.' : 'An administrator needs to upload the customer CSV before predictions are available.'}</p>{upload && <button className="primary-button" onClick={upload}><FileUp size={16}/> Upload customer CSV</button>}{status.error && <small className="api-error">{status.error}</small>}{upload && <p className="csv-hint">Required target column: <code>customer_segment</code></p>}</div></>
  return <><div className="page-heading"><div><div className="eyebrow"><Sparkles size={14}/> LIVE CLASSIFICATION</div><h1>Make a <em>prediction</em></h1><p>Enter a customer's details to estimate their category.</p></div><span className="status-pill is-ready"><i/> Model ready</span></div>
    {notice && <div className="notice error-notice"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15}/></button></div>}
    <div className="predict-layout"><form className="card prediction-form" onSubmit={submit}><div className="card-heading"><div><span className="card-kicker">CUSTOMER PROFILE</span><h2>Customer details</h2></div><button type="button" className="text-button" onClick={() => setForm(Object.fromEntries(status.features.map(f => [f.name, f.type === 'number' ? '' : (f.choices?.[0] || '')])))}><RotateCcw size={14}/> Reset</button></div><p className="form-intro">Fields match the columns in your dataset. Identifier columns are excluded automatically.</p><div className="form-grid">{status.features.map(f => <label className="field" key={f.name}><span>{pretty(f.name)}</span>{f.choices?.length ? <select required value={form[f.name] ?? ''} onChange={e => setForm({ ...form, [f.name]: e.target.value })}>{f.choices.map(c => <option key={c} value={c}>{pretty(c)}</option>)}</select> : <input required type={f.type === 'number' ? 'number' : 'text'} step={f.type === 'number' ? 'any' : undefined} value={form[f.name] ?? ''} onChange={e => setForm({ ...form, [f.name]: e.target.value })} placeholder={f.type === 'number' ? 'Enter a value' : 'Enter text'}/>}</label>)}</div><button className="primary-button run-prediction" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>} {busy ? 'Predicting…' : 'Predict customer category'}</button><div className="form-privacy"><Check size={14}/> Prediction is generated by your trained model and stays on this machine.</div></form>
      <div className="card result-card"><span className="card-kicker">PREDICTION RESULT</span>{prediction ? <><div className="result-orbit"><div><Sparkles size={20}/></div></div><span className="result-caption">Predicted category</span><h2>{pretty(prediction.category)}</h2><div className="confidence-row"><span>Model confidence</span><b>{pct(prediction.confidence)}</b></div><div className="confidence-track"><span style={{ width: `${prediction.confidence * 100}%` }}/></div><div className="probability-list"><b>Class probabilities</b>{prediction.probabilities.map((p, i) => <div key={p.name}><span><i style={{ background: palette[i % palette.length] }}/>{pretty(p.name)}</span><b>{pct(p.probability)}</b></div>)}</div><p className="result-footnote">Confidence is the model's estimated probability, not a guarantee.</p></> : <div className="result-placeholder"><div className="result-orbit muted"><div><Target size={19}/></div></div><b>Your result will appear here</b><span>Complete the customer profile and run a prediction.</span></div>}</div></div>
  </>
}

function MethodPage({ status, data }) {
  const steps = [['01', 'Explore & clean', 'Inspect missing values, remove duplicates, and drop rows without a customer segment.'], ['02', 'Prepare features', 'Separate the target from features and exclude customer identifiers. Impute numeric values by median and scale them; impute categories by mode and one-hot encode them.'], ['03', 'Train & evaluate', 'Use a stratified 80/20 train-test split (random_state 42), then fit Logistic Regression (max_iter 1000).'], ['04', 'Predict', 'Pass new customer records through the same fitted preprocessing pipeline and return class probabilities.']]
  return <><div className="page-heading"><div><div className="eyebrow"><BrainCircuit size={14}/> UNDER THE HOOD</div><h1>Model & <em>method</em></h1><p>A clear view of the machine learning workflow behind each result.</p></div></div><div className="method-overview"><div className="method-icon"><BrainCircuit size={23}/></div><div><span className="card-kicker">CLASSIFICATION ALGORITHM</span><h2>Multinomial Logistic Regression</h2><p>Supervised multiclass learning for four customer groups. An interpretable baseline that estimates a probability for each category.</p></div><div className="model-chip">{status.ready ? 'TRAINED' : 'AWAITING DATA'}</div></div><section className="card workflow-card"><div className="card-heading"><div><span className="card-kicker">END-TO-END WORKFLOW</span><h2>From customer data to category</h2></div></div><div className="workflow-list">{steps.map(([num, title, desc]) => <div className="workflow-step" key={num}><div className="step-number">{num}</div><div><b>{title}</b><p>{desc}</p></div><Check size={16}/></div>)}</div></section><div className="method-bottom"><div className="card"><span className="card-kicker">TRAINING DATA</span><h2>{status.ready ? status.rows.toLocaleString() : '50,000'} <small>records</small></h2><p>{status.ready ? 'Loaded from your CSV dataset.' : 'The project presentation reports 50,000 retail customer records across 14 columns.'}</p></div><div className="card"><span className="card-kicker">HELD-OUT SCORE</span><h2>{data?.metrics ? pct(data.metrics.accuracy) : '66.4%'} <small>accuracy</small></h2><p>{data?.metrics ? 'Recalculated from your uploaded dataset.' : 'Reported in the project presentation; live values appear after training.'}</p></div><div className="card"><span className="card-kicker">WEIGHTED F1</span><h2>{data?.metrics ? pct(data.metrics.f1) : '65.6%'} <small>F1 score</small></h2><p>{data?.metrics ? 'Recalculated from your uploaded dataset.' : 'Reported in the project presentation; live values appear after training.'}</p></div></div><div className="method-note"><ArrowDownRight size={16}/><span>Model performance depends on the quality and representativeness of the dataset. The project reports that the Regular segment was hardest to distinguish.</span></div></>
}
