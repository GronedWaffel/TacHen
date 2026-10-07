// SPDX-License-Identifier: GPL-3.0-or-later
// Adapted from PS Neighborhood platform plumbing; see vendor/runtime-provenance.json.
import {createServer as tcpServer} from './net.mjs';
import {Readable,Writable} from 'readable-stream';
const reasons={200:'OK',202:'Accepted',204:'No Content',206:'Partial Content',400:'Bad Request',401:'Unauthorized',403:'Forbidden',404:'Not Found',405:'Method Not Allowed',409:'Conflict',413:'Content Too Large',416:'Range Not Satisfiable',429:'Too Many Requests',500:'Internal Server Error'};
export function createServer(handler){const server=tcpServer(socket=>{
 let input=Buffer.alloc(0),handled=false;socket.setTimeout(30000,()=>socket.destroy());
 socket.on('error',()=>{});
 socket.on('data',chunk=>{if(handled)return;input=Buffer.concat([input,chunk]);const split=input.indexOf('\r\n\r\n');if(split<0){if(input.length>16384)socket.destroy();return;}if(split>16384)return socket.destroy();
 const lines=input.subarray(0,split).toString().split('\r\n'),first=/^(GET|POST|HEAD|DELETE) (\S+) HTTP\/1\.[01]$/.exec(lines.shift());if(!first)return socket.destroy();
 const headers={};for(const line of lines){const colon=line.indexOf(':');if(colon<1)return socket.destroy();const name=line.slice(0,colon).toLowerCase();if(name in headers)return socket.destroy();headers[name]=line.slice(colon+1).trim();}
 if(headers['transfer-encoding'])return socket.destroy();const length=Number(headers['content-length']||0);if(!Number.isSafeInteger(length)||length<0||length>2*1048576)return socket.destroy();if(input.length<split+4+length)return;
 handled=true;const req=Readable.from([input.subarray(split+4,split+4+length)]);req.url=first[2];req.method=first[1];req.headers=headers;req.socket=socket;input=null;
 let started=false;const res=new Writable({write(data,_encoding,cb){head();socket.write(data,cb);},final(cb){head();socket.end();cb();},destroy(e,cb){if(e)socket.destroy();cb(e);}});res.statusCode=200;res.headers={};res.setHeader=(key,value)=>{res.headers[key]=value;};res.writeHead=(code,extra={})=>{res.statusCode=code;Object.assign(res.headers,extra);head();};
 function head(){if(started)return;started=true;res.headersSent=true;const values={Connection:'close','X-Content-Type-Options':'nosniff',...res.headers};const text=`HTTP/1.1 ${res.statusCode} ${reasons[res.statusCode]||'Response'}\r\n`+Object.entries(values).map(([k,v])=>`${k}: ${String(v).replace(/[\r\n]/g,'')}`).join('\r\n')+'\r\n\r\n';socket.write(text);}
 socket.on('close',()=>res.emit('close'));res.on('error',()=>{});Promise.resolve(handler(req,res)).catch(()=>{if(!started){res.writeHead(500);res.end('Request failed');}else socket.destroy();});
 });});return server;}
export function request(){throw Error('PS5 native package services are required');}
export default {createServer,request};
