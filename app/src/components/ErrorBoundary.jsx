import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props){
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error){
    return { error }
  }

  componentDidCatch(error, info){
    // Log for debugging; in production you could send to a logger.
    console.error('App crashed:', error, info)
  }

  render(){
    if (this.state.error){
      const msg = this.state.error?.message || String(this.state.error)
      return (
        <div style={{padding:16, fontFamily:'system-ui,sans-serif'}}>
          <h2 style={{margin:'0 0 8px 0'}}>The app crashed</h2>
          <div style={{color:'#b00020', whiteSpace:'pre-wrap', wordBreak:'break-word'}}>{msg}</div>
          <div style={{marginTop:12}}>
            <button type="button" onClick={()=>window.location.reload()}>Reload</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}


