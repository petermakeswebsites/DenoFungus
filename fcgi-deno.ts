import {fcgi} from 'https://deno.land/x/fcgi/mod.ts';
import * as eta from 'https://deno.land/x/eta/mod.ts';

console.log(`Started on 127.0.0.1:8989`);

const INI_FILE = 'denoconfig.ts'
const TIMEOUT = 10


let fileCache : {[filename : string]: number} = {}
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

            // Initializing or getting worker for this document root
            const worker = await getWorker(req.params.get("DOCUMENT_ROOT"))
            const res = await worker.sendPromise({action: 'req', req: req.params, cookies: req.cookies})
            console.log('res: ', res)

            const filename = req.params.get("SCRIPT_FILENAME")
            if (filename !== undefined) {

                const filenameExtArr = filename.split('.')
                const filenameExt = filenameExtArr[filenameExtArr.length-1]
                const modules = {
                    eta: eta,
                }
                if (filenameExt == 'ejs') {
                    const response = await eta.renderFile(filename, {req: req, modules: modules})
                    await req.respond({body: response as string})
                } else if (filenameExt == 'ts') {

                    const file = await Deno.stat(filename)

                    if (file.isFile) {
                        const time = file.mtime?.getTime() || 0
                        console.log("Last modified:", time);
                        if (filename in fileCache) {
                            if (time > fileCache[filename]) {
                                // Update cache
                                console.log('file changed, updating: ', time)
                                fileCache[filename] = time
                            } else {
                                console.log('file unchanged: ', time)
                            }
                        } else {
                            // No index, create new
                            console.log('no index, create new: ', time)
                            fileCache[filename] = time
                        }
                        
                        const cachedFileURL = filename + '#' + fileCache[filename]
                        const parseModule = await import(cachedFileURL)
                        await parseModule.parse(req, modules)

                    } else {
                        throw new Error('Error: File not found' + filename)
                    }

                } else {
                    throw new Error('Error: Neither ejs nor ts extension: ' + filename)
                }
                
             } else {
                 throw new Error('script filename undefined')
             }
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
        this.onerror = (e) => {
        }
    }

    private idCounter = 0
    private callbackStore : {[id : number]: [(value : unknown) => any, (reason?: any) => any]} = {}

    private handleMessage(e : MessageEvent) {
        const id = e.data.id
        const callback = this.callbackStore[id][0]
        delete this.callbackStore[id]
        callback(e.data.data)
    }

    sendPromise(data : any) {
        const id = this.idCounter++
        console.log('posting message...')
        this.postMessage({id: id, data: data})
        return new Promise((resolve, reject) => {
            this.callbackStore[id] = [resolve, reject]
        })
    }
}