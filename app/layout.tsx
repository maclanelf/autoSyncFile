import "./globals.css";
import { Providers } from "./providers";
export const metadata={title:"Rclone Control Room",description:"任务同步控制台"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body><Providers>{children}</Providers></body></html>}
