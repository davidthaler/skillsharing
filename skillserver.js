const {createServer} = require('http')
const Router = require('./router')
const ecstatic = require('ecstatic')

const router = new Router()
const defaultHeaders = {'Content-Type': 'text/plain'}

class SkillServer{
    constructor(talks){
        this.talks = talks
        this.version = 0
        this.waiting = []

        let fileServer = ecstatic({root: './public'})
        this.server = createServer((request, response) => {
            let resolved = router.resolve(this, request)
            if(resolved){
                resolved.catch(error => {
                    if(error.status != null) return error
                    return {body: String(error), status:500}
                }).then(({body, status=200, headers=defaultHeaders}) => {
                    console.log(`${status} ${request.method} ${request.url}`)
                    response.writeHead(status, headers)
                    response.end(body)
                })
            }else{
                fileServer(request, response)
            }
        })
    }

    start(port){
        this.server.listen(port)
    }

    stop(){
        this.server.close()
    }

    talkResponse(){
       let talks = Object.values(this.talks)
        return {
            body: JSON.stringify(talks),
            headers: {'Content-Type': 'application/json',
                      'ETag' : `"${this.version}"`}
        }
    }

    waitForChanges(time){
        return new Promise(resolve => {
            this.waiting.push(resolve)
            setTimeout( () => {
                if(!this.waiting.includes(resolve)) return
                this.waiting = this.waiting.filter(r => r != resolve)
                resolve({status: 304})
            }, time * 1000)
        })
    }

    updated(){
        this.version++
        let response = this.talkResponse()
        this.waiting.forEach(resolve => resolve(response))
        this.waiting = []
    }
}

router.add('GET', /^\/talks$/, async (server, request) => {
    let tag = /"(.*)"/.exec(request.headers['if-none-match'])
    let wait = /\bwait=(\d+)/.exec(request.headers['prefer'])
    if(!tag || tag[1] != server.version){
        return server.talkResponse()
    }else if(!wait){
        return {status: 304}
    }else{
        return server.waitForChanges(Number(wait[1]))
    }
})

const talkPath = /^\/talks\/([^\/]+)$/;
router.add('GET', talkPath, async (server, title) => {
    if(title in server.talks){
        return {
            body: JSON.stringify(server.talks[title]),
            headers: {'Content-Type': 'application/json'}
        }
    }else{
        return {status: 404, body:`No talk found: ${title}`}
    }
})

router.add('DELETE', talkPath, async(server, title) => {
    if(title in server.talks){
        delete server.talks[title]
        server.updated()
    }
    return {status: 204}
})

function readStream(stream){
    return new Promise((resolve, reject) => {
        let data = ''
        stream.on('error', reject)
        stream.on('data', chunk => data += chunk.toString())
        stream.on('end', () => resolve(data))
    })
}

router.add('PUT', talkPath, async(server, title, request) => {
    let requestBody = await readStream(request)
    let talk
    try{
        talk = JSON.parse(requestBody)
    }catch (_){
        return {status:400, body: 'Invalid JSON\n'}
    }
    if(!talk || 
        typeof talk.presenter != 'string' || 
        typeof talk.summary != 'string'){
            return {status: 400, body: 'Bad talk\n'}
        }
    server.talks[title] = {title, 
                            presenter:talk.presenter, 
                            summary:talk.summary, 
                            comments:[]}
    server.updated()
    return {status: 204}
})

router.add('POST', /^\/talks\/([^\/]+)\/comments$/ , async(server, title, request) => {
    let requestBody = await readStream(request)
    let comment
    try{
        comment = JSON.parse(requestBody)
    }catch(e){
        return {status:400, body:'Invalid JSON'}
    }
    if(!comment || 
        typeof comment.author != 'string' || 
        typeof comment.message != 'string'){
            return {status: 400, body: 'Bad Comment\n'}
        }else if(title in server.talks){
            server.talks[title].comments.push(comment)
            server.updated()
            return {status: 204}
        }else{
            return {status:404, body:`No talk found: ${title}`}
        }
})

new SkillServer(Object.create(null)).start(8000)
