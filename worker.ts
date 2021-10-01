let modules = {}

// Find out how to post message back and forth??
//console.log('fetching', await fetch("https://deno.land/"))
console.log('worker initialized')

//@ts-ignore
self.onmessage = async (e : MessageEvent) => {
    try {
        let success : (data : any) => any
        let failure : (data : any) => any
        let data : any
        if ('id' in e.data && 'data' in e.data) {
            //@ts-ignore
            success = (data : any) => self.postMessage({id: e.data.id, status: 1, data: data})
            //@ts-ignore
            failure = (data : any) => self.postMessage({id: e.data.id, status: 0, data: data})
            data = e.data.data
        } else {
            throw new Error('No ID or DATA passed in web worker request')
        }

        try {
            if ('action' in data) {
                switch(data.action) {
                    case 'init':
                        try {
                            await initializeWorker(data.configFile)
                            success({message: 'Initialized'})
                        } catch(err) {
                            failure({message: 'Failed to initialize..' + err})
                        }
                    break
                    case 'req':
                        console.log('req from inside:', data.req, data.cookies)
                        success({message: 'yay!'})
                    break
                    default:
                        throw new Error(`action '${data.action}' not recognised`)
                }
            } else {
                throw new Error('no action in data')
            }

        } catch(err) {
            failure({message: err})
        }

    } catch(err) {
        console.log('Web worker error: ', err)
    }
}

async function initializeWorker(path : string) {
    try {
        const { modules } = await import(path)
        Object.freeze(modules)
    } catch(err) {
        Object.freeze(modules)
        throw new Error('None or bad config file: ' + path)
    } 
}