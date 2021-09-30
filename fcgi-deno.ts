import {fcgi} from 'https://deno.land/x/fcgi/mod.ts';
import * as eta from 'https://deno.land/x/eta/mod.ts';
import * as mysql from "https://deno.land/x/mysql/mod.ts";
import * as queryString from "https://deno.land/x/querystring@v1.0.2/mod.js";
import * as mongo from "https://deno.land/x/mongo@v0.27.0/mod.ts"

console.log(`Started on 127.0.0.1:8989`);
let i = 0

// let sessions = {} 
// let sessionManager {
//      hasSession = 
// }
// session storage

let fileCache : {[filename : string]: number} = {}

fcgi.listen
(    '127.0.0.1:8989',
    '',
    async req => {   
        const t0 = performance.now();
        console.log(req.params.get("SCRIPT_FILENAME"))
        req.responseHeaders.set('Content-Type', 'text/html')
        try {
            const filename = req.params.get("SCRIPT_FILENAME")
            if (filename !== undefined) {

                const filenameExtArr = filename.split('.')
                const filenameExt = filenameExtArr[filenameExtArr.length-1]
                const modules = {
                    mysql: mysql,
                    eta: eta,
                    queryString: queryString,
                    mongo: mongo
                }
                if (filenameExt == 'ejs') {
                    const response = await eta.renderFile(filename, {req: req, modules: modules})
                    await req.respond({body: response as string})
                } else if (filenameExt == 'ts') {

                    const file = await Deno.stat(filename);

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
);