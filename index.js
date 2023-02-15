const AppChannel            = require('node-mermaid/store/app-channel')()
    , AppTransportChannel   = require('node-mermaid/store/app-transport-channel')()
    , AppMemoryFileJSON     = require('node-mermaid/store/app-memory-file-json')
    , { io }                = require('socket.io-client')
    , path                  = require('path')
    , fs                    = require('fs')
    , fse                   = require('fs-extra')
    , clientManager         = require('./client-manager')

const clients = new AppMemoryFileJSON('clients', [], 10000)

clients.read().then(
  clients =>
    clientManager.connect(clients.map(({ ip }) => ip))
)

AppChannel.on('connect', () => {
  AppTransportChannel.on('connect', () => {
    AppChannel.on('reload', () => {
      AppTransportChannel.writeData({
        type: 'reload'
      })
    })

    AppChannel.on('status', data => {
      data.forEach(({ platform, online }) => {
        Object.keys(clientManager.state).forEach(async ip => {
          if (clientManager.state[ip][platform]) {
            if (online === false) {
              clientManager.state[ip][platform].close()
              clientManager.state[ip][platform] = null
            }
          } else {
            if (online !== false) {
              const client = clients.readInterval().find(client => client.ip === ip)

              if (client && (client.platform === platform || client.platform === 'All platforms')) {
                clientManager.state[ip][platform] = io(
                  `${ip.match(/^(http:\/\/|https:\/\/)/gi) ? '' : 'http://'}${ip}:6767?platform=${platform}`,
                  {
                    options: {
                      reconnectionDelayMax: 10000
                    }
                  }
                )

                clientManager.state[ip][platform].on('disconnect', async () => {
                  AppTransportChannel.writeData({
                    type: 'status-client',
                    data: {
                      id: client.id,
                      isConnected: false
                    }
                  })
                })

                clientManager.state[ip][platform].on('connect', async () => {
                  AppTransportChannel.writeData({
                    type: 'status-client',
                    data: {
                      id: client.id,
                      isConnect: true
                    }
                  })
                })

                if (client.flag === 'Read and write') {
                  clientManager.state[ip][platform].on('input', data => {
                    if (data.platform === platform) {
                      if (data.platform && data.text) {
                        AppChannel.sendMessage(data.platform, data.text)
                        return
                      }
                    }
                  })
                }
              }
            }
          }
        })
      })
    })

    AppChannel.on('data', data => {
      Object.keys(clientManager.state).forEach(ip => {
        if (clientManager.state[ip][data.platform]) {
          clientManager.state[ip][data.platform].emit('output', JSON.stringify(data))
        }
      })
    })

    AppTransportChannel.on('readData', async ({ type, data }) => {
      if (type === 'get-clients') {
        AppTransportChannel.writeData({
          type: 'get-clients',
          data: await clients.read()
        })

        Object.keys(clientManager.state).forEach(ip => {
          const client = clients.readInterval().find(client => client.ip === ip)

          Object.keys(clientManager.state[ip]).forEach(platform => {
            if (clientManager.state[ip][platform].connected) {
              AppTransportChannel.writeData({
                type: 'status-client',
                data: {
                  id: client.id,
                  isConnect: true
                }
              })
            }
          })
        })
      }

      if (type === 'set-clients') {
        try {
          await clients.write(data)
          clientManager.disconnect()
          clientManager.connect(data.map(({ ip }) => ip))
        } catch (e) {}

        AppTransportChannel.writeData({
          type: 'get-clients',
          data: await clients.read()
        })
      }
    })
  })
})
