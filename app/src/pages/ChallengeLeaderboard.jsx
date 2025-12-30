import { useEffect, useState } from 'react'
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { db } from '../lib/firebase'

export default function ChallengeLeaderboard(){
  const [state, setState] = useState({ loading:true, rows:[], error:null })

  useEffect(()=>{
    (async()=>{
      setState({ loading:true, rows:[], error:null })
      try{
        const qs = await getDocs(
          query(
            collection(db,'challengeStats'),
            where('daysParticipated','>=',5),
            orderBy('avgPoints','desc'),
            limit(100)
          )
        )
        const rows = qs.docs.map(d=>({ id:d.id, ...d.data() }))
        setState({ loading:false, rows, error:null })
      }catch(err){
        setState({ loading:false, rows:[], error: err?.message || String(err) })
      }
    })()
  },[])

  return (
    <div style={{padding:16, width:'100%', maxWidth: 900, margin:'0 auto'}}>
      <h1>Leaderboard</h1>
      <p style={{color:'#666', marginTop:0}}>
        Average points over all participation days. Minimum <b>5</b> days to appear.
      </p>

      {state.loading && <div>Loading…</div>}
      {!!state.error && <div style={{color:'#a00'}}>{state.error}</div>}

      {!state.loading && !state.error && (
        <div style={{overflowX:'auto', border:'1px solid #eee', borderRadius:10, background:'#fff'}}>
          <table style={{width:'100%', borderCollapse:'collapse'}}>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>User</Th>
                <Th>Avg</Th>
                <Th>Days</Th>
                <Th>Total</Th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((r, i)=>(
                <tr key={r.id} style={{borderTop:'1px solid #f0f0f0'}}>
                  <Td>{i+1}</Td>
                  <Td>{r.username || 'anon'}</Td>
                  <Td>{Number(r.avgPoints || 0).toFixed(1)}</Td>
                  <Td>{Number(r.daysParticipated || 0)}</Td>
                  <Td>{Number(r.totalPoints || 0)}</Td>
                </tr>
              ))}
              {!state.rows.length && (
                <tr style={{borderTop:'1px solid #f0f0f0'}}>
                  <Td colSpan={5} style={{color:'#666'}}>No qualifying users yet.</Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Th({ children }){
  return <th style={{textAlign:'left', padding:'10px 12px', fontSize:'.95rem', color:'#333'}}>{children}</th>
}

function Td({ children, ...rest }){
  return <td {...rest} style={{padding:'10px 12px', color:'#222', ...rest.style}}>{children}</td>
}


