import * as eta from 'https://deno.land/x/eta/mod.ts';
import type { ServerResponse } from 'https://deno.land/x/fcgi/mod.ts';
let mods = {}

// Find out how to post message back and forth??
//console.log('fetching', await fetch("https://deno.land/"))
console.log('worker initialized')

const SESSION_EXPIRATION = 60 // minutes
const SESSION_COOKIE_ID = 'DENOSESSID'
const sessions: {[sessid : string] : {data: {[x : string]: any}, last : number}} = {}

const fileCache : {[filename : string]: number} = {}

//@ts-ignore: onmessage not supported
self.onmessage = async (e : MessageEvent) => {
    try {
        if ('id' in e.data && 'data' in e.data) {
            //@ts-ignore: postmessage not supported by vscode
            const success = (data : ServerResponse) => self.postMessage({id: e.data.id, error: 0, update: 0, data: data})
            //@ts-ignore: postmessage not supported by vscode
            const update = (data : {action: string, [x: string] : any}) => self.postMessage({id: e.data.id, error: 0, update: 1, data: data})
            //@ts-ignore: postmessage not supported by vscode
            const failure = (data : ServerResponse) => self.postMessage({id: e.data.id, error: 1, update: 0, data: data})
            const data = e.data.data
            try {
                if ('action' in data) {
                    switch(data.action) {
                        case 'init':
                            try {
                                await initializeWorker(data.configFile)
                                success({body: 'Initialized'})
                            } catch(err) {
                                failure({body: 'Failed to initialize..' + err})
                            }
                        break
                        case 'req': {
                            const params = data.params
                            console.log('data cookies:', JSON.stringify(data.cookies))

                            const cookies = new WorkerCookies(update, data.cookies)
                            const session = new SessionInstance(update, cookies)
                            const req = {params: params, cookies: cookies, session: session}
                            //console.log('req from inside:', params, cookies)
                            const filename = params.get("SCRIPT_FILENAME")
                            if (filename !== undefined) {

                                const respond = (responseArgs : Record<string, unknown>) => success(responseArgs)

                                const filenameExtArr = filename.split('.')
                                const filenameExt = filenameExtArr[filenameExtArr.length-1]
                                if (filenameExt == 'ejs') {
                                    const response = await eta.renderFile(filename, {req: req, modules: mods})
                                    await respond({body: response as string})
                                } else if (filenameExt == 'ts') {
                                    const cachedFileURL = await parseFileCache(filename)
                                    const { parse } = await import(cachedFileURL)
                                    const response = await parse(req, mods, update)
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
                failure({body: 'There was an error:' + err})
            }
            
        } else {
            throw new Error('No ID or DATA passed in web worker request')
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
    sessid = ''
    cookies : Map<string, string>
    update : (data: any) => any
   
    constructor(update : (data: any) => any, cookies : WorkerCookies) {
      this.update = update
      this.cookies = cookies
    }
   
    start() {
        const potentialSessionCookie = this.cookies.get(SESSION_COOKIE_ID)
        if (potentialSessionCookie !== undefined) {
            console.log('Session cookie not undefined: ', potentialSessionCookie)
            // Check if it matches one in db
            if (potentialSessionCookie in sessions) {
                const SSID = potentialSessionCookie
                console.log('Session cookie hit!')
                // Check if expired
                const now = Date.now() / 1000
                if ((now - sessions[SSID].last) > (SESSION_EXPIRATION*60)) {
                    // Expired
                    console.log('Session expired... creating new one')
                    delete sessions[SSID]
                    this.newSession()
                } else {
                    console.log('Session not expired, retrieving')
                    sessions[SSID].last = now
                    this.data = sessions[SSID].data
                    this.sessid = SSID
                }
            } else {
                console.log('Session cookie miss!')
                this.newSession()
            }
            
        } else {
            this.newSession()
        }
    }

    destroy() {
        delete sessions[this.sessid]
        this.sessid = ''
        this.data = {}
        this.cookies.delete(SESSION_COOKIE_ID)
    }

    private newSession() {
        const now = Date.now() / 1000
        const sessid = this.generateUniqueString()
        console.log('No session cookie, creating new one: ', sessid)
        this.cookies.set(SESSION_COOKIE_ID, sessid)
        sessions[sessid] = {
            last: now,
            data: this.data
        }
        this.sessid = sessid
    }

    private generateUniqueString() {
        const newStr = () => Array.from({length:64}, () => String.fromCharCode((Math.random() * 24 + 65) | 0)).join('')
        let ssid = newStr()
        while (ssid in sessions) { ssid = newStr() }
        return ssid
    }
}

class WorkerCookies extends Map{
    update : (data: any) => any = () => undefined

    constructor(update : (data: any) => any, cookies : Map<string, string>) {
        super()
        for (const [name, val] of cookies.entries()) { super.set(name, val) }
        this.update = update
    }

    set(name : string , value : string ){
        this.update({action: 'setCookie', name: name, value: value})
        return super.set(name, value);
    }

    delete(name: string) {
        this.update({action: 'deleteCookie', name: name})
        return super.delete(name)
    }

    list() {
        const cookieList : Record<string, string> = {}
        for (const [name, val] of super.entries()) { cookieList[name] = val}
        return cookieList
    }
}

export type RequestObject = {
    params: Map<string, string>,
    session: SessionInstance,
    cookies: WorkerCookies
}