import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, CartesianGrid
} from 'recharts'
import './index.css'

interface Transaction {
  id: number;
  amount: number;
  type: 'ingreso' | 'gasto';
  category: string;
  description: string;
  date: string;
}

interface FixedExpense {
  id: number;
  amount: number;
  category: string;
  description: string;
}

interface Balance {
  ingresos: number;
  gastos: number;
  balance: number;
  desglose_ingresos: Record<string, number>;
  desglose_gastos: Record<string, number>;
}

const COLORS = [
  '#1e3a8a', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', 
  '#bfdbfe', '#0ea5e9', '#0284c7', '#0369a1', '#075985'
];

const GASTO_CATEGORIES = ['Hogar', 'Comida', 'Transporte', 'Plataformas Digitales', 'Suscripciones', 'Salud', 'Educación', 'Deudas', 'Entretenimiento', 'Regalos', 'Donación'];
const INGRESO_CATEGORIES = ['Salario', 'Bonos', 'Dividendos', 'Comisiones', 'Préstamos', 'Herencia', 'Otros'];

function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'manual' | 'fijos' | 'historial'>('dashboard')
  const [balance, setBalance] = useState<Balance>({
    ingresos: 0, gastos: 0, balance: 0, desglose_ingresos: {}, desglose_gastos: {}
  })
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>([])
  const [loading, setLoading] = useState(true)

  // Manual Form State
  const [formDate, setFormDate] = useState(new Date().toISOString().substring(0, 10))
  const [formItem, setFormItem] = useState('')
  const [formType, setFormType] = useState('gasto')
  const [formCategory, setFormCategory] = useState(GASTO_CATEGORIES[0])
  const [formValue, setFormValue] = useState('')
  const [formStatus, setFormStatus] = useState('')

  // Fixed Expense Form State
  const [feItem, setFeItem] = useState('')
  const [feCategory, setFeCategory] = useState(GASTO_CATEGORIES[0])
  const [feValue, setFeValue] = useState('')
  const [feStatus, setFeStatus] = useState('')

  // Editing State
  const [editingTx, setEditingTx] = useState<Transaction | null>(null)
  const [editingFe, setEditingFe] = useState<FixedExpense | null>(null);
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

  const fetchData = async () => {
    try {
      const balRes = await fetch(`${API_URL}/api/balance`)
      if (balRes.ok) setBalance(await balRes.json())

      const transRes = await fetch(`${API_URL}/api/transactions`)
      if (transRes.ok) setTransactions(await transRes.json())

      const feRes = await fetch(`${API_URL}/api/fixed-expenses`)
      if (feRes.ok) setFixedExpenses(await feRes.json())
    } catch (err) {
      console.error("Error fetching", err)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 6000)
    return () => clearInterval(interval)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormStatus('Guardando...')
    try {
      const payload = {
        amount: parseFloat(formValue),
        type: formType,
        category: formCategory,
        description: formItem,
        date: new Date(formDate).toISOString()
      }
      const req = await fetch(`${API_URL}/api/transactions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (req.ok) {
        setFormStatus('✅ Registrado exitosamente'); setFormItem(''); setFormValue(''); fetchData()
        setTimeout(() => setFormStatus(''), 3000)
      } else { setFormStatus('⚠️ Error al registrar') }
    } catch { setFormStatus('❌ Error de conexión') }
  }

  const handleApplyFixedExpenses = async () => {
    if(!confirm("¿Deseas aplicar todos los gastos fijos al mes actual? Esto descontará el dinero de tu saldo restante.")) return;
    setFeStatus('Aplicando gastos...')
    try {
      const req = await fetch(`${API_URL}/api/fixed-expenses/apply`, { method: 'POST' })
      if (req.ok) {
        const json = await req.json()
        setFeStatus(`✅ ${json.applied_count} gastos aplicados correctamente al balance`)
        fetchData()
        setTimeout(() => setFeStatus(''), 5000)
      }
    } catch { setFeStatus('❌ Error conectando') }
  }

  const handleAddFixedExpense = async (e: React.FormEvent) => {
    e.preventDefault()
    setFeStatus('Guardando...');
    try {
       const req = await fetch(`${API_URL}/api/fixed-expenses`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: parseFloat(feValue), category: feCategory, description: feItem })
       });
       if(req.ok) {
          setFeStatus('✅ Gasto fijo configurado'); setFeItem(''); setFeValue(''); fetchData()
          setTimeout(() => setFeStatus(''), 3000)
       }
    } catch { setFeStatus('❌ Error') }
  }

  const handleDeleteTx = async (id: number) => {
    if(!confirm('¿Eliminar esta transacción de forma permanente?')) return;
    try {
      await fetch(`${API_URL}/api/transactions/${id}`, { method: 'DELETE' });
      fetchData();
    } catch(err) { console.error(err) }
  }

  const handleMakeFixed = async (t: Transaction) => {
    if(!confirm(`¿Quieres convertir "${t.description}" en un Gasto Fijo recurrente de ${formatCurrency(t.amount)}?`)) return;
    try {
      const req = await fetch(`${API_URL}/api/fixed-expenses`, {
         method: 'POST', headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ amount: t.amount, category: t.category, description: t.description })
      });
      if(req.ok) { alert('✅ Añadido a tu plantilla de Gastos Fijos'); fetchData() }
    } catch(err) { console.error(err) }
  }

  const handleSaveEdit = async () => {
    if(!editingTx) return;
    try {
       await fetch(`${API_URL}/api/transactions/${editingTx.id}`, {
         method: 'PUT', headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
            amount: editingTx.amount, type: editingTx.type, 
            category: editingTx.category, description: editingTx.description, date: editingTx.date
         })
       });
       setEditingTx(null);
       fetchData();
    } catch(e) { console.error(e) }
  }

  const handleDeleteFe = async (id: number) => {
    if(!confirm('¿Eliminar este Gasto Fijo de la plantilla permanentemente?')) return;
    try {
      await fetch(`${API_URL}/api/fixed-expenses/${id}`, { method: 'DELETE' });
      fetchData();
    } catch(err) { console.error(err) }
  }

  const handleSaveEditFe = async () => {
    if(!editingFe) return;
    try {
       await fetch(`${API_URL}/api/fixed-expenses/${editingFe.id}`, {
         method: 'PUT', headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ amount: editingFe.amount, category: editingFe.category, description: editingFe.description })
       });
       setEditingFe(null);
       fetchData();
    } catch(e) { console.error(e) }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(amount)
  }

  const chartIngresosVsGastos = [
    { name: 'Ingresos', Monto: balance.ingresos, fill: 'url(#colorIngresos)' },
    { name: 'Gastos', Monto: balance.gastos, fill: 'url(#colorGastos)' }
  ]

  const chartRestante = [
    { name: 'Gastos', value: balance.gastos },
    { name: 'Restante', value: balance.balance > 0 ? balance.balance : 0 }
  ]

  const chartPresupuesto = Object.entries(balance.desglose_gastos)
    .map(([cat, amount]) => ({ name: cat, Monto: amount }))
    .sort((a, b) => b.Monto - a.Monto)

  if (loading) return <div className="dashboard-container"><div className="header"><h1>Cargando Datos...</h1></div></div>

  return (
    <div className="dashboard-container">
      <div className="header">
        <h1>Centro Financiero</h1>
        
        <div className="tabs-container" style={{ marginTop: '20px', display: 'flex', gap: '15px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className={`glass-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>📊 Ver Dashboard</button>
          <button className={`glass-btn ${activeTab === 'historial' ? 'active' : ''}`} onClick={() => setActiveTab('historial')}>📋 Historial Maestro</button>
          <button className={`glass-btn ${activeTab === 'manual' ? 'active' : ''}`} onClick={() => setActiveTab('manual')}>✍️ Registro Rápido</button>
          <button className={`glass-btn ${activeTab === 'fijos' ? 'active' : ''}`} onClick={() => setActiveTab('fijos')}>⚙️ Gastos Fijos</button>
        </div>
      </div>

      {activeTab === 'historial' && (
        <div style={{ maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
          <div className="glass-panel text-center" style={{marginBottom: '20px'}}>
             <h2>Gestor Integral de Movimientos</h2>
             <p style={{color: 'var(--text-secondary)'}}>Edita, elimina o convierte movimientos temporales en gastos automáticos mes a mes.</p>
          </div>
          
          <div className="glass-panel" style={{ overflowX: 'auto' }}>
            <table className="finance-table">
               <thead><tr><th>Día</th><th>Descripción</th><th>Categoría</th><th>Tipo</th><th>Valor</th><th>Acciones</th></tr></thead>
               <tbody>
                 {transactions.map(t => (
                    <tr key={t.id}>
                       {editingTx?.id === t.id ? (
                          <>
                             <td>---</td>
                             <td><input className="inline-input" value={editingTx.description} onChange={e=>setEditingTx({...editingTx, description:e.target.value})} /></td>
                             <td>
                               <select className="inline-select" value={editingTx.category} onChange={e=>setEditingTx({...editingTx, category:e.target.value})}>
                                  {editingTx.type === 'gasto' ? GASTO_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>) : INGRESO_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
                               </select>
                             </td>
                             <td>
                               <select className="inline-select" value={editingTx.type} onChange={e=>setEditingTx({...editingTx, type: e.target.value as any})}>
                                  <option value="gasto">Gasto</option>
                                  <option value="ingreso">Ingreso</option>
                               </select>
                             </td>
                             <td><input type="number" className="inline-input" value={editingTx.amount} onChange={e=>setEditingTx({...editingTx, amount:parseFloat(e.target.value)})} /></td>
                             <td>
                                <button className="action-btn success" onClick={handleSaveEdit}>Guardar</button>
                                <button className="action-btn danger" onClick={()=>setEditingTx(null)}>Cancelar</button>
                             </td>
                          </>
                       ) : (
                          <>
                             <td>{new Date(t.date).toLocaleDateString()}</td>
                             <td>{t.description}</td>
                             <td>{t.category}</td>
                             <td>{t.type === 'ingreso' ? <span style={{color:'var(--accent-green)', fontWeight:'bold'}}>IN</span> : <span style={{color:'var(--accent-red)', fontWeight:'bold'}}>OUT</span>}</td>
                             <td className="amount-col">{formatCurrency(t.amount)}</td>
                             <td style={{display: 'flex', gap: '8px'}}>
                               <button className="action-btn edit" onClick={() => setEditingTx(t)}>✏️ Editar</button>
                               <button className="action-btn danger" onClick={() => handleDeleteTx(t.id)}>🗑️ Borrar</button>
                               {t.type === 'gasto' && !t.description.includes('(Fijo)') && (
                                  <button className="action-btn template" onClick={() => handleMakeFixed(t)}>📌 Fijar</button>
                               )}
                             </td>
                          </>
                       )}
                    </tr>
                 ))}
                 {transactions.length === 0 && <tr><td colSpan={6} style={{textAlign:'center', padding:'20px'}}>No hay transacciones todavía.</td></tr>}
               </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'manual' && (
        <div className="glass-panel manual-form-section" style={{ maxWidth: '600px', margin: '0 auto', width: '100%' }}>
          <h2>Nueva Transacción</h2>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="form-group"><label>Día (Fecha)</label><input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} required /></div>
            <div className="form-group"><label>Ítem (Descripción corta)</label><input type="text" placeholder="Ej. Gasolina, Netflix" value={formItem} onChange={(e) => setFormItem(e.target.value)} required /></div>
            <div className="form-group"><label>Tipo de Movimiento</label><select value={formType} onChange={(e) => { setFormType(e.target.value); setFormCategory(e.target.value === 'gasto' ? GASTO_CATEGORIES[0] : INGRESO_CATEGORIES[0]) }}><option value="gasto">Gasto</option><option value="ingreso">Ingreso</option></select></div>
            <div className="form-group"><label>Categoría</label><select value={formCategory} onChange={(e) => setFormCategory(e.target.value)}> {formType === 'gasto' ? GASTO_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>) : INGRESO_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)} </select></div>
            <div className="form-group"><label>Valor ($)</label><input type="number" min="1" step="any" placeholder="Ej. 15000" value={formValue} onChange={(e) => setFormValue(e.target.value)} required /></div>
            <button type="submit" className="glass-submit-btn">Guardar Transacción</button>
            {formStatus && <p style={{ textAlign: 'center', color: 'var(--accent-green)', fontWeight: 'bold' }}>{formStatus}</p>}
          </form>
        </div>
      )}

      {activeTab === 'fijos' && (
        <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: '30px' }}>
           <div className="glass-panel text-center">
             <h2>Cargar Gastos del Mes</h2>
             <p style={{color: 'var(--text-secondary)'}}>Procesa con un clic todos tus gastos recurrentes fijos (ej: arriendo, suscripciones) restándolos de tu dinero al iniciar el mes.</p>
             <button className="glass-submit-btn" style={{backgroundColor: 'var(--accent-red)', color: 'white', border: '1px solid #7f1d1d'}} onClick={handleApplyFixedExpenses}>
                🚀 Cobrar Gastos del Mes Automáticamente
             </button>
             {feStatus && <p style={{marginTop:'15px', color:'var(--text-primary)'}}>{feStatus}</p>}
           </div>

           <div className="glass-panel">
             <h2>Configurar Nuevo Gasto Fijo</h2>
             <form onSubmit={handleAddFixedExpense} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div className="form-group"><label>Ítem (Ej: Arriendo, Internet, Gym)</label><input type="text" value={feItem} onChange={e=>setFeItem(e.target.value)} required /></div>
                <div className="form-group"><label>Categoría</label><select value={feCategory} onChange={e=>setFeCategory(e.target.value)}>{GASTO_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
                <div className="form-group"><label>Valor Mensual Fijo ($)</label><input type="number" min="1" step="any" value={feValue} onChange={e=>setFeValue(e.target.value)} required /></div>
                <button type="submit" className="glass-submit-btn" style={{background: 'linear-gradient(135deg, var(--accent-green), #047857)'}}>Añadir Gasto Fijo a la Plantilla</button>
             </form>
           </div>

           <div className="glass-panel">
             <h2>Tus Gastos Fijos (Plantilla)</h2>
             {fixedExpenses.length === 0 ? <p style={{color:'var(--text-secondary)'}}>No tienes gastos fijos configurados aún.</p> : (
             <table className="finance-table">
                 <thead><tr><th>Descripción</th><th>Categoría</th><th>Monto Fijo</th><th>Acciones</th></tr></thead>
                 <tbody>
                    {fixedExpenses.map(fe => (
                       <tr key={fe.id}>
                          {editingFe?.id === fe.id ? (
                             <>
                                <td><input className="inline-input" value={editingFe.description} onChange={e=>setEditingFe({...editingFe, description:e.target.value})} /></td>
                                <td>
                                  <select className="inline-select" value={editingFe.category} onChange={e=>setEditingFe({...editingFe, category:e.target.value})}>
                                     {GASTO_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
                                  </select>
                                </td>
                                <td><input type="number" className="inline-input" value={editingFe.amount} onChange={e=>setEditingFe({...editingFe, amount:parseFloat(e.target.value)})} /></td>
                                <td>
                                   <button className="action-btn success" onClick={handleSaveEditFe}>Guardar</button>
                                   <button className="action-btn danger" style={{marginLeft:'5px'}} onClick={()=>setEditingFe(null)}>Cancelar</button>
                                </td>
                             </>
                          ) : (
                             <>
                                <td>{fe.description}</td><td>{fe.category}</td><td className="amount-col">{formatCurrency(fe.amount)}</td>
                                <td style={{display: 'flex', gap: '8px'}}>
                                  <button className="action-btn edit" onClick={() => setEditingFe(fe)}>✏️ Editar</button>
                                  <button className="action-btn danger" onClick={() => handleDeleteFe(fe.id)}>🗑️ Borrar</button>
                                </td>
                             </>
                          )}
                       </tr>
                    ))}
                 </tbody>
               </table>
             )}
           </div>
        </div>
      )}

      {activeTab === 'dashboard' && (
        <>
          <div className="stats-grid">
            <div className="glass-panel stat-card income">
               <h3>Ingresos Mensuales</h3>
               <p className="stat-value value-positive">{formatCurrency(balance.ingresos)}</p>
            </div>
            <div className="glass-panel stat-card expense">
               <h3>Gastos Mensuales</h3>
               <p className="stat-value value-negative">{formatCurrency(balance.gastos)}</p>
            </div>
            <div className="glass-panel stat-card">
               <h3>Dinero Restante</h3>
               <p className="stat-value value-warning">{formatCurrency(balance.balance)}</p>
            </div>
          </div>
          <div className="charts-grid">
            <div className="glass-panel chart-box">
              <h2 className="chart-title">FLUJO DE CAJA</h2>
              <div className="chart-wrapper">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartIngresosVsGastos} margin={{ top: 20 }}>
                    <defs>
                      <linearGradient id="colorIngresos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.9}/>
                        <stop offset="95%" stopColor="#1e3a8a" stopOpacity={0.3}/>
                      </linearGradient>
                      <linearGradient id="colorGastos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.9}/>
                        <stop offset="95%" stopColor="#7f1d1d" stopOpacity={0.3}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="name" stroke="var(--text-secondary)" tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--text-secondary)" tickLine={false} axisLine={false} tickFormatter={(val: number) => '$'+(val/1000)+'k'} />
                    <Tooltip formatter={(value: any) => formatCurrency(Number(value))} cursor={{fill: 'rgba(255,255,255,0.02)'}} />
                    <Bar dataKey="Monto" radius={[8, 8, 0, 0]} maxBarSize={60} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="glass-panel chart-box">
              <h2 className="chart-title">DISTRIBUCIÓN DE SALDO</h2>
              <div className="chart-wrapper">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={chartRestante} innerRadius={80} outerRadius={110} paddingAngle={5} dataKey="value" stroke="none" cornerRadius={6}>
                      <Cell fill="url(#colorGastos)" />
                      <Cell fill="url(#colorIngresos)" />
                    </Pie>
                    <Tooltip formatter={(value: any) => formatCurrency(Number(value))} />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pie-overlay" style={{ marginTop: '-15px' }}>
                    <h3 style={{ fontSize: '1.4rem' }}>{formatCurrency(balance.balance)}</h3>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Restante</span>
                </div>
              </div>
            </div>
          </div>
          <div className="glass-panel full-width-chart">
            <h2 className="chart-title">¿CÓMO GASTAS? (PRESUPUESTO)</h2>
            <div style={{ width: '100%', height: 380 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartPresupuesto} layout="vertical" margin={{ top: 10, right: 30, left: 40, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.05)" />
                    <XAxis type="number" stroke="var(--text-secondary)" tickLine={false} axisLine={false} tickFormatter={(val: number) => '$'+val/1000+'k'} />
                    <YAxis dataKey="name" type="category" stroke="var(--text-secondary)" width={120} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value: any) => formatCurrency(Number(value))} cursor={{fill: 'rgba(255,255,255,0.02)'}} />
                    <Bar dataKey="Monto" minPointSize={3} radius={[0, 8, 8, 0]} barSize={20}>
                      {chartPresupuesto.map((_e, ind) => <Cell key={`cell-${ind}`} fill={COLORS[ind % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
            </div>
          </div>
          <div className="tables-grid">
            <div className="glass-panel">
              <h2>Tabla de Ingresos</h2>
              <table className="finance-table">
                <thead><tr><th>Tipo</th><th>Monto</th></tr></thead>
                <tbody>{Object.entries(balance.desglose_ingresos).sort((a,b)=>b[1]-a[1]).map(([cat, val]) => (<tr key={cat}><td>{cat}</td><td className="amount-col">{formatCurrency(val as number)}</td></tr>))}</tbody>
                <tfoot><tr><td><strong>Total</strong></td><td className="amount-col value-positive"><strong>{formatCurrency(balance.ingresos)}</strong></td></tr></tfoot>
              </table>
            </div>
            <div className="glass-panel">
              <h2>Tabla de Gastos</h2>
              <table className="finance-table">
                <thead><tr><th>Categoría</th><th>Monto</th></tr></thead>
                <tbody>{Object.entries(balance.desglose_gastos).sort((a,b)=>b[1]-a[1]).map(([cat, val]) => (<tr key={cat}><td>{cat}</td><td className="amount-col">{formatCurrency(val as number)}</td></tr>))}</tbody>
                <tfoot><tr><td><strong>Total</strong></td><td className="amount-col value-negative"><strong>{formatCurrency(balance.gastos)}</strong></td></tr></tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default App
