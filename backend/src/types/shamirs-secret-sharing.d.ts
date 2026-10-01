declare module 'shamirs-secret-sharing' {
  interface SplitOptions {
    shares: number;
    threshold: number;
  }

  function split(secret: Buffer, options: SplitOptions): Buffer[];
  function combine(shares: Buffer[]): Buffer;

  const sss: { split: typeof split; combine: typeof combine };
  export default sss;
}
