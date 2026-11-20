import type { Config } from 'tailwindcss';
export default { content: ['./app/**/*.{js,ts,jsx,tsx,mdx}','./components/**/*.{js,ts,jsx,tsx,mdx}'], theme: { extend: { colors: { ink:'#14221f', forest:'#176b55', mint:'#dff5e9', canvas:'#f5f7f5' }, boxShadow: { soft:'0 12px 40px rgba(18,48,38,.08)' } } }, plugins: [] } satisfies Config;
