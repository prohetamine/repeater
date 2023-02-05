const AppChannel            = require('node-mermaid/store/app-channel')()
    , AppTransportChannel   = require('node-mermaid/store/app-transport-channel')()
    , appMemoryFolderPath   = require('node-mermaid/store/app-memory-folder-path')
    , { io }                = require('socket.io-client')
    , path                  = require('path')
    , fs                    = require('fs')
    , fse                   = require('fs-extra')
    , clientManager         = require('./client-manager')

const clientsPath = path.join(appMemoryFolderPath, 'clients.json')

if (!fs.existsSync(clientsPath)) {
  fs.writeFileSync(
    clientsPath,
    JSON.stringify([])
  )
}

let clientsLocalMemo = []

const readClients = async () => {
  let data = []

  try {
    data = JSON.parse(await fse.readFileSync(clientsPath, 'utf8'))
  } catch (e) {
    data = []
  }

  clientsLocalMemo = data
  return data
}

const writeClients = async data => {
  try {
    await fse.writeFileSync(clientsPath, JSON.stringify(data))
    clientsLocalMemo = data
    return true
  } catch (e) {
    return false
  }
}

readClients().then(
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
              const client = clientsLocalMemo.find(client => client.ip === ip)

              if (client.platform === platform || client.platform === 'All platforms') {
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
                  clientManager.state[ip][platform].on('input', ({ platform, text }) => {
                    if (platform && text) {
                      AppChannel.sendMessage(platform, text)
                      return
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
          data: await readClients()
        })
      }

      if (type === 'set-clients') {
        try {
          await writeClients(data)
          clientManager.disconnect()
          clientManager.connect(data.map(({ ip }) => ip))
        } catch (e) {}

        AppTransportChannel.writeData({
          type: 'get-clients',
          data: await readClients()
        })
      }
    })
  })
})
