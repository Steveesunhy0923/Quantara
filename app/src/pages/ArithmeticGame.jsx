export default function ArithmeticGame(){
  return (
    <div style={{padding:16, width:'100%', maxWidth: 1100, margin:'0 auto'}}>
      <h1 style={{marginBottom:8}}>120s Arithmetic</h1>
      <p style={{color:'#666', marginTop:0}}>
        The game (including the leaderboard) is served at <code>/arithmetic.html</code>. It’s embedded below.
      </p>
      <div style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:12}}>
        <a href="/arithmetic.html" style={{textDecoration:'none'}}>
          <button type="button">Open full page</button>
        </a>
      </div>
      <iframe
        title="120s Arithmetic"
        src="/arithmetic.html"
        style={{
          width:'100%',
          height:'82vh',
          border:'1px solid #e5e5e5',
          borderRadius: 8,
          background:'#fff'
        }}
      />
    </div>
  )
}


