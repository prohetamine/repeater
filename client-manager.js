module.exports = (() => {
  const state = {}

  const connect = ips => {
    for (let i = 0; i < ips.length; i++) {
      const ip = ips[i]
      if (!state[ip]) {
        state[ip] = {}
      }
    }
  }

  const disconnect = () => {
    Object.keys(state).forEach(ip => {
      if (state[ip]) {
        Object.keys(state[ip]).forEach(platform => {
          if (state[ip][platform]) {
            state[ip][platform].close()
            state[ip][platform] = null
          }
        })
        delete state[ip]
      }
    })
  }

  return {
    state,
    connect,
    disconnect
  }
})()
