import * as eta from 'https://deno.land/x/eta/mod.ts';
import type { ServerResponse } from 'https://deno.land/x/fcgi/mod.ts';
let mods = {}

// Find out how to post message back and forth??
//console.log('fetching', await fetch("https://deno.land/"))
console.log('worker initialized')

const SESSION_EXPIRATION = 10 // minutes
const SESSION_COOKIE_ID = 'DENOSESSID'
const sessions: {[sessid : string] : {[x : string]: any}} = {}

const fileCache : {[filename : string]: number} = {}

//@ts-ignore: onmessage not supported
self.onmessage = async (e : MessageEvent) => {
    try {
        let success : (data : any) => any
        let failure : (data : any) => any
        let update : (data : any) => any
        let data : any
        if ('id' in e.data && 'data' in e.data) {
            //@ts-ignore: postmessage not supported by vscode
            success = (data : ServerResponse) => self.postMessage({id: e.data.id, error: 0, update: 0, data: data})
            //@ts-ignore: postmessage not supported by vscode
            update = (data : {action: string, [x: string] : any}) => self.postMessage({id: e.data.id, error: 0, update: 1, data: data})
            //@ts-ignore: postmessage not supported by vscode
            failure = (data : ServerResponse) => self.postMessage({id: e.data.id, error: 1, update: 0, data: data})
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
                    case 'req': {
                        const params = data.params
                        const cookies = data.cookies
                        //console.log('req from inside:', params, cookies)
                        const filename = params.get("SCRIPT_FILENAME")
                        if (filename !== undefined) {

                            const respond = (responseArgs : Record<string, unknown>) => success(responseArgs)

                            const filenameExtArr = filename.split('.')
                            const filenameExt = filenameExtArr[filenameExtArr.length-1]
                            if (filenameExt == 'ejs') {
                                const response = await eta.renderFile(filename, {params: params, modules: mods})
                                await respond({body: response as string})
                            } else if (filenameExt == 'ts') {
                                const cachedFileURL = await parseFileCache(filename)
                                const { parse } = await import(cachedFileURL)
                                const response = await parse(params, mods, update)
                                respond(response)

                            } else {
                                throw new Error('Error: Neither ejs nor ts extension: ' + filename)
                            }
                            
                        } else {
                            throw new Error('script filename undefined')
                        }
                    }
                    break
                    default:
                        throw new Error(`action '${data.action}' not recognised`)
                    break
                }
            } else {
                throw new Error('no action in data')
            }

        } catch(err) {
            failure({message: 'There was an error:' + err})
        }

    } catch(err) {
        console.log('Web worker error: ', err)
    }
}

async function initializeWorker(path : string) {
    try {
        const { modules } = await import(path)
        mods = modules
        Object.freeze(mods)
    } catch {
        Object.freeze(mods)
        throw new Error('None or bad config file: ' + path)
    } 
}

async function parseFileCache(filename : string) {

    const file = await Deno.stat(filename)

    if (file.isFile) {
        const time = file.mtime?.getTime() || 0
        //console.log("Last modified:", time);
        if (filename in fileCache) {
            if (time > fileCache[filename]) {
                // Update cache
                //console.log('file changed, updating: ', time)
                fileCache[filename] = time
            } else {
                //console.log('file unchanged: ', time)
            }
        } else {
            // No index, create new
            //console.log('no index, create new: ', time)
            fileCache[filename] = time
        }
        
        return filename + '#' + fileCache[filename]

    } else {
        throw new Error('File not found' + filename)
    }
}

class SessionInstance {
    data: Record<string, unknown> = {}
    update : () => any
   
    constructor(update : () => any, sessioncookie? : string) {
      this.update = update
      if (sessioncookie !== undefined) {
        // if previous sessionid cookie is here - if yes, check to see if it matches with any in 'sessions'? expiration ?
      }
    }
   
    async start() {
        
    }
  }
