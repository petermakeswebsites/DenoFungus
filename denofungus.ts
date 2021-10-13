import {fcgi} from 'https://deno.land/x/fcgi/mod.ts';
import type {ServerResponse, ServerRequest} from 'https://deno.land/x/fcgi/mod.ts';

console.log(`Started on 127.0.0.1:8989`);

// INI file in the root directory of a particular virtual host
const INI_FILE = 'fungusconfig.ts'

// Holds the different workers that are responsible to jail each individual virtual host
const workerCache : {[server: string]: PromiseWorker} = {}

fcgi.listen
(    '127.0.0.1:8989',
    '',
    async req => {   
        const t0 = performance.now();
        // Get local link to the ts script to be ran
        console.log('Req:', req.params.get("SCRIPT_FILENAME"))
        try {
            req.responseHeaders.set('Content-Type', 'text/html')

            // Initializing or getting cached worker for this particular document root
            const worker = await getWorker(req.params.get("DOCUMENT_ROOT"))

            // Update function unique to this particular request.
            // Listens to update from web worker
            const update = async (data : any) => await handleUpdate(req, data)

            req.cookies.entries() // Somehow this initializes the map and allows it to be passed?
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



/**
 * Creates a new web worker based on the document root of the request, or retrieves one from cache if it already exists.
 * @param documentRoot The document root
 * @returns The PromiseWorker unique to the web worker's document root
 */
async function getWorker(documentRoot : string | undefined) {

    if (documentRoot === undefined) { throw new Error('Undefined document root - cannot process web worker')}
    if(documentRoot in workerCache) {
        return workerCache[documentRoot]
    } else {
        // Initializing a new PromiseWorker
        workerCache[documentRoot] = new PromiseWorker(new URL("./worker.ts", import.meta.url).href, {
            type: "module",
            deno: {
                namespace: true,
                permissions: {
                    net: true, // Can access all net 
                    read: [
                        documentRoot // Can read anything in the document root (and nothing else)
                    ],
                    write: [
                        documentRoot // Can write anything in the document root (and nothing else)
                    ]
                }
            }
        })

        //Init config for worker cache
        await workerCache[documentRoot].sendPromise({action: 'init', configFile: documentRoot + '/' + INI_FILE})
        return workerCache[documentRoot]
    }
}

/**
 * Promise Worker is a promise wrapper around a regular worker that assigns a unique ID to an outgoing message and listens for responses with that ID.
 */
class PromiseWorker extends Worker {
    constructor(specifier: string | URL, options?: WorkerOptions | undefined) {
        super(specifier, options)
        this.addEventListener('message', (e) => {
            this.handleMessage(e)
        })
    }

    private idCounter = 0
    private callbackStore : {
        [id : number]:[
            (value : unknown) => unknown, // Success callback
            (reason?: unknown) => unknown, // Fail callback
            (data : unknown) => unknown // Update callback (does not end the promise)
            ]
        } = {}

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

    /**
     * Sends a message to the worker
     * @param data the data to send to the worker
     * @param update a callback function which can be called by the worker that does not end the promise
     * @returns 
     */
    sendPromise(data : unknown, update : (data : unknown) => unknown = () => undefined) {
        const id = this.idCounter++
        this.postMessage({id: id, data: data})
        return new Promise((resolve, reject) => {
            this.callbackStore[id] = [resolve, reject, update]
        })
    }
}

/**
 * 
 * @param req The server request to send updates to
 * @param data Object containing an 'action' attribute defining the action
 */
async function handleUpdate(req : ServerRequest, data : {action: string, [x : string] : unknown}) {
    switch(data.action) {
        case 'setCookie': {
            console.log('Setting cookie! ', data)
            if (data.name && typeof data.name === 'string' && data.value && typeof data.value === 'string')
                await req.cookies.set(data.name, data.value)
        }
        break
        case 'deleteCookie': {
            console.log('Deleting cookie! ', data)
            if (data.name && typeof data.name === 'string')
                await req.cookies.delete(data.name)
        }
        break
        case 'setHeader': {
            console.log('Setting header! ', data)
            if (data.name && typeof data.name === 'string' && data.value && typeof data.value === 'string')
                await req.responseHeaders.set(data.name, data.value)
        }
        break
        default: {
            console.log('Recevied update but no matching action! ', data)
        }
    }
}