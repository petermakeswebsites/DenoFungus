# DenoFungus

Use Deno like PHP

> :warning: ***This is experimental! There are likely many bugs and security issues.***

A FastCGI server that listens to requests and then dynamically imports the file requested by the client. This project was created because I really loved the syntax of TypeScript but there were some use cases where I wanted to use it like PHP (rendering a specific script file rather than running a whole application).

1. Client requests yoursite.com/example.ts
2. Your webserver redirects to DenoFungus (just as it would to be PHP) using FastCGI
3. DenoFungus dynamically imports and parses the requested URL
4. The output is returned to your web server, which is then forwarded to the client via your web server

*Note*: DenoFungus will automatically spawn a child thread (a worker) for every unique document root. Each worker is responsible for holding modules (see under usage). This was an idea I had that sacrificed some speed for security. That way one virtual host (assuming there is a unique document root per virtual host and vice versa) will not be able to easily wreck other virtual hosts running on the server.

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [What's the point?](#why)
- [Support](#support)
- [Contributing](#contributing)

## Installation

You require a web server that can communicate with a FastCGI server. By default, DenoFungus runs on 127.0.0.1:8989. For web server installation instructions for your particular web server, please refer to the [Deno FCGI](https://deno.land/x/fcgi@v1.0.0) module's configuration examples.

Download this project either through git or downloading the zip and extracting somewhere.

## Usage

In your terminal, run `deno run --allow-read --allow-net --unstable fcgi-deno.ts` from the project directory.

Now DenoFungus should be running. Assuming you've connected your web server to DenoFungus (see [installation](#installation)), create a file, just like PHP, which imports a function. DenoFungus will automatically detect whne the file has changed and re-import any modifications.

Example:

public_html/test.ts
```typescript
export async function main() {

  // Put all logic in here, if outside of main function, it will only run *once* until DenoFungus restarts or the file changes

  const text = 'hello world!'
  return {body: text}
}
```

Navigating to yourwebsite.com/test.ts should yield `'hello world!'`

### Request Managament

Request data is passed through to main by a request object.

#### Cookies

Cookies are accessed by a map object called cookies. When a cookie is set in this object, an update is sent to the main thread of the FCGI Server to set a cookie header to the browser. Always use set / get with cookies. Never modify the map directly like a regular object.

```typescript
import type { RequestObject } from 'https://deno.land/x/denofungus/worker.ts'
export async function main(req : RequestObject) {

  req.cookies.set("Name", "Portobello")
  req.cookies.get("Name")
  return {body: req.cookies.get("Name")}

}
```

#### Request Parameters

Similar to cookies, params are a map object that you can retreieve with GET.

```typescript
...
  const clientIP = req.params.get("REMOTE_ADDR")
  return {body: 'Your IP is: ' + clientIP}
...
```

#### Session Managament

DenoFungus has a built-in session manager that works just like PHPs (as far as I can remember). It stores a cookie on the client's browser which uniquely identifies an object in the back-end. Sessions expire after 60 minutes but this can be modified in worker.ts. I'm going to make it configurable in a separate file later.

`session.start()` checks to see if there is a matching session, creates one if not. Must be called before any session data can be accessed or modified **for each request**.
`session.destroy()` destroys the current session
`session.data` references the object associated with the current client's session information

```typescript
...
  req.session.start()
  if !('counter' in req.session.data) {
      req.session.data["counter"] = 0
  }
  const counter = req.session.data["counter"]++
  if (counter >= 10) {
      req.session.destroy()
  }
  return {body: `You have visited this page: ${counter} times`}
...
```

### Modules

Modules are shared for every worker. They are created in the document root directory under a special file named `fungusconfig.ts`. If there is no file, there will be no modules.

Example of a `fungusconfig.ts`
```typescript
import * as eta from 'https://deno.land/x/eta/mod.ts';
import * as mysql from "https://deno.land/x/mysql/mod.ts";
import * as queryString from "https://deno.land/x/querystring@v1.0.2/mod.js";
import * as mongo from "https://deno.land/x/mongo@v0.27.0/mod.ts"

const modules = {
    eta: eta,
    mysql: mysql,
    queryString: queryString,
    mongo: mongo
}

export {modules}
```

`example.ts`:
```typescript
import type { modules } from './fungusconfig.ts'
import type { RequestObject } from 'https://deno.land/x/denofungus/worker.ts'

export async function parse(req : RequestObject, mods : typeof modules) {
    const querystring = req.params.get("QUERY_STRING")
    const qs = (querystring !== undefined ) ? mods.queryString.parse(querystring) : {}
    let helloString
    if ('hello' in qs) {
        helloString = qs.toString() || 'No hello!'
    }
    return {body: helloString}
    // example.com/example.ts renders 'No hello!'
    // example.com/example.ts?hello=World renders "World"
}
```

These modules will be held by the worker sub-process (unique to every host document root). This way they can be accessed by any files that share the same document root. This saves some processing time compared to regular imports, and I think RAM  too.

Importing types are expensive for some reason, so for to test the 'real' speed of your file, remove the type imports. Disable type-checking when running denofungus using the `--no-check` option. It seems like even with no check, deno is still doing something extra.

## Why

After falling in love with TypeScript, I wanted to create a replacement for WordPress with Deno for my web clients. A CMS they could manage while I design the front-end. If I were hosting one server, it would make sense to just use a headless CMS like [Ghost](ghost.org). But on a server with lots of clients' websites, having a lot of these processes running eats up RAM, and each individual one has to be reverse-proxied and then occupy it's own port. DenoFungus is my solution to the aforementioned problems.

Please note that there are many reasons why you **wouldn't** want to use this, but here are some reasons why you might want to:

### What it solves:

- **RAM Utlization:** If one process can hold all the modules (database, templating, etc), then there won't be so much overhead for hosting multiple websites.

## Support

Please [open an issue](https://github.com/petermakeswebsites/denofungus/issues/new) for support.

## Contributing

Security, performance, memory leaks. If anything occurs to you, please let me know!

Todo: 

- [ ] Make a better config file for customising things like session expiration time
- [ ] Make a simple and easy way to get request types for the main() function (session, cookies, params)
- [ ] Find a good templating engine to use for another extension, making it HTML-first, TypeScript-second.

