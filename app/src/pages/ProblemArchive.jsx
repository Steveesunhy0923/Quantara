import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore'
import { db } from '../lib/firebase'

function nowMillis(){
  return Date.now()
}

export default function ProblemArchive(){
  const [state, setState] = useState({ loading:true, rows:[], error:null })

  useEffect(()=>{
    (async()=>{
      setState({ loading:true, rows:[], error:null })
      try{
        const qs = await getDocs(query(collection(db, 'dailyChallenges'), orderBy('dateKey', 'desc'), limit(200)))
        const rows = qs.docs.map(d=>({ id: d.id, ...d.data() }))
        setState({ loading:false, rows, error:null })
      }catch(err){
        setState({ loading:false, rows:[], error: err?.message || String(err) })
      }
    })()
  },[])

  const visible = useMemo(()=>{
    const now = nowMillis()
    return state.rows.filter(r=>{
      const pub = r.publishAt?.toMillis ? r.publishAt.toMillis() : (typeof r.publishAt === 'number' ? r.publishAt : 0)
      return !pub || pub <= now
    })
  },[state.rows])

  return (
    <div style={{padding:16, width:'100%', maxWidth: 900, margin:'0 auto'}}>
      <h1>Problem Archive</h1>
      <p style={{color:'#666', marginTop:0}}>
        Past daily problems (shown after they publish at <b>8:00pm ET</b>).
      </p>

      {state.loading && <div>Loading…</div>}
      {!!state.error && <div style={{color:'#a00'}}>{state.error}</div>}

      {!state.loading && !state.error && (
        <div style={{display:'grid', gap:10}}>
          {visible.map(r=>(
            <div key={r.id} style={{border:'1px solid #eee', borderRadius:10, background:'#fff', padding:12}}>
              <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:12}}>
                <div style={{fontWeight:800}}>{r.dateKey || r.id}</div>
                <div style={{color:'#666', fontSize:'.9rem'}}>{r.difficulty || ''}</div>
              </div>
              <div style={{marginTop:8}}>
                <Link to={`/challenge/daily/${encodeURIComponent(r.dateKey || r.id)}`} style={{textDecoration:'none', color:'#1a73e8', fontWeight:700}}>
                  View
                </Link>
              </div>
            </div>
          ))}

          {!visible.length && (
            <div style={{border:'1px solid #eee', borderRadius:10, background:'#fff', padding:12, color:'#666'}}>
              No problems yet.
            </div>
          )}
        </div>
      )}
    </div>
  )
}




