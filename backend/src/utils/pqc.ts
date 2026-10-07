import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';

export const PQC = {
  kem: ml_kem768,
  dsa: ml_dsa65,
  
  async generateKeyPair() {
    return await ml_kem768.keygen();
  },
  
  async generateSigningKeyPair() {
    return await ml_dsa65.keygen();
  }
};

export default PQC;