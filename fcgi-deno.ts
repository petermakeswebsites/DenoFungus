import {fcgi} from 'https://deno.land/x/fcgi/mod.ts';
import type {ServerResponse, ServerRequest} from 'https://deno.land/x/fcgi/mod.ts';
import * as eta from 'https://deno.land/x/eta/mod.ts';

console.log(`Started on 127.0.0.1:8989`);

const INI_FILE = 'denoconfig.ts'
const TIMEOUT = 10


let workerCache : {[server: string]: PromiseWorker} = {}

fcgi.listen
(    '127.0.0.1:8989',
    '',
    async req => {   
        const t0 = performance.now();
        console.log('Req:', req.params.get("SCRIPT_FILENAME"))
        //console.log('Req:', req)

        // Server_name
        req.responseHeaders.set('Content-Type', 'text/html')
        try {
            //Initializing or getting worker for this document root
            const worker = await getWorker(req.params.get("DOCUMENT_ROOT"))

            console.log('whats happening... ')
            const update = async (data : any) => {
                return await handleUpdate(req, data)
            }
            const res = (await worker.sendPromise({action: 'req', params: req.params, cookies: req.cookies}, update)) as ServerResponse
            await req.respond(res)
            
        } catch(err) {
            console.log(err)
            await req.respond({body: err.message})
        }
        const t1 = performance.now();
        console.log(`Took ${t1 - t0} ms`)
    }
)




async function getWorker(documentRoot : string | undefined) {

    console.log('^4Worker handler')
    if (documentRoot === undefined) { throw new Error('undefined server name')}
    if(documentRoot in workerCache) {
        console.log('Worker hit for: ', documentRoot)
        return workerCache[documentRoot]
    } else {
        console.log('No worker hit for server, creating new: ', documentRoot)

        // Check initial config in Docroot?

        workerCache[documentRoot] = new PromiseWorker(new URL("./worker.ts", import.meta.url).href, {
            type: "module",
            deno: {
                namespace: true,
                permissions: {
                    net: true,
                    read: [
                        documentRoot
                    ],
                    write: [
                        documentRoot
                    ]
                }
            }
        })
        await workerCache[documentRoot].sendPromise({action: 'init', configFile: documentRoot + '/' + INI_FILE})
        return workerCache[documentRoot]
    }
}

class PromiseWorker extends Worker {
    constructor(specifier: string | URL, options?: WorkerOptions | undefined) {
        super(specifier, options)
        this.onmessage = (e) => {
            this.handleMessage(e)
        }
    }

    private idCounter = 0
    private callbackStore : {[id : number]: [(value : unknown) => any, (reason?: any) => any, (data : any) => any]} = {}

    private handleMessage(e : MessageEvent) {
        const id = e.data.id
        const error = e.data.error
        const update = e.data.update || 0

        console.log('Error: ', error, 'for ID', id)
        const store = this.callbackStore[id]
        const callback = update ? store[2] : store[error]
        if (!update) delete this.callbackStore[id]
        callback(e.data.data)
    }

    sendPromise(data : any, update : (data : any) => any = () => undefined) {
        const id = this.idCounter++
        console.log('Posting message...', id)
        this.postMessage({id: id, data: data})
        return new Promise((resolve, reject) => {
            this.callbackStore[id] = [resolve, reject, update]
        })
    }
}

async function handleUpdate(req : ServerRequest, data : {action: string, [x : string] : any}) {
    switch(data.action) {
        case 'setCookie': {
            console.log('Setting cookie! ', data)
            await req.cookies.set(data.name, data.value)
        }
        break
        case 'setHeader': {
            console.log('Setting cookie! ', data)
            await req.responseHeaders.set(data.name, data.value)
        }
        break
        default: {
            console.log('Recevied update but no matching action! ', data)
        }
    }
}