import { Link } from 'react-router-dom'

export default function Test(){
  return (
    <div style={{padding:16, width:'100%', maxWidth: 900, margin:'0 auto'}}>
      <h1>Math Games</h1>
      <p style={{color:'#666', marginTop:0}}>Pick a game to play.</p>

      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))', gap:12, marginTop:16}}>
        <GameCard
          title="120s Arithmetic"
          desc="Answer as many arithmetic problems as you can in 2 minutes."
          to="/test/arithmetic"
          cta="Play Arithmetic"
        />
        <GameCard
          title="Function Ball (Physics)"
          desc="Use functions as surfaces to guide a ball from start to finish. Gravity/mass/friction change per level."
          to="/test/function-ball"
          cta="Play Function Ball"
        />
      </div>

      <p style={{marginTop:18, color:'#777', fontSize:'.95rem'}}>
        Tip: In Function Ball, you can create your own levels and export/import them as JSON.
      </p>
    </div>
  )
}

function GameCard({ title, desc, to, cta }){
  return (
    <div style={{border:'1px solid #ddd', borderRadius:10, padding:14, background:'#fff', color:'#111'}}>
      <h3 style={{margin:'0 0 .25rem 0'}}>{title}</h3>
      <p style={{margin:'0 0 .9rem 0', color:'#555'}}>{desc}</p>
      <Link to={to} style={{display:'inline-block', padding:'.55rem .9rem', borderRadius:8, background:'#1a73e8', color:'#fff', textDecoration:'none'}}>
        {cta}
      </Link>
    </div>
  )
}
