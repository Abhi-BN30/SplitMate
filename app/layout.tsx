import type {Metadata,Viewport} from 'next';import './globals.css';
export const metadata:Metadata={title:'SplitMate — Expenses, simplified',description:'Smart group expense splitting for friends.',manifest:'/manifest.webmanifest',appleWebApp:{capable:true,statusBarStyle:'default',title:'SplitMate'}};
export const viewport:Viewport={themeColor:'#f5f7f5',width:'device-width',initialScale:1,maximumScale:1};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}<script dangerouslySetInnerHTML={{__html:`if ('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));`}} /></body></html>}
