const path = require('path')
const {
  readFileSync,
  existsSync,
  mkdirSync
} = require('fs')
const {
  bsv,
  compileContract: compileContractImpl,
  getPreimage,
  toHex
} = require('scryptlib')
const { privateKey } = require('./privateKey');
const MSB_THRESHOLD = 0x7e;

const Signature = bsv.crypto.Signature
const BN = bsv.crypto.BN
const Interpreter = bsv.Script.Interpreter

// number of bytes to denote some numeric value
const DataLen = 1

const axios = require('axios')
const API_PREFIX = 'https://api.whatsonchain.com/v1/bsv/test'

const inputIndex = 0
const inputSatoshis = 100000
const flags = Interpreter.SCRIPT_VERIFY_MINIMALDATA | Interpreter.SCRIPT_ENABLE_SIGHASH_FORKID | Interpreter.SCRIPT_ENABLE_MAGNETIC_OPCODES | Interpreter.SCRIPT_ENABLE_MONOLITH_OPCODES
const minFee = 546
const dummyTxId = 'a477af6b2667c29670467e4e0728b685ee07b240235771862318e29ddbe58458'
const reversedDummyTxId = '5884e5db9de218238671572340b207ee85b628074e7e467096c267266baf77a4'
const sighashType2Hex = s => s.toString(16)

function newTx() {
  const utxo = {
    txId: 'a477af6b2667c29670467e4e0728b685ee07b240235771862318e29ddbe58458',
    outputIndex: 0,
    script: '',   // placeholder
    satoshis: inputSatoshis
  };
  return new bsv.Transaction().from(utxo);
}



// reverse hexStr byte order
function reverseEndian(hexStr) {
  let num = new BN(hexStr, 'hex')
  let buf = num.toBuffer()
  return buf.toString('hex').match(/.{2}/g).reverse().join('')
}

async function createPayByOthersTx(address) {
  // step 1: fetch utxos
  let {
    data: utxos
  } = await axios.get(`${API_PREFIX}/address/${address}/unspent`)

  utxos = utxos.map((utxo) => ({
    txId: utxo.tx_hash,
    outputIndex: utxo.tx_pos,
    satoshis: utxo.value,
    script: bsv.Script.buildPublicKeyHashOut(address).toHex(),
  }))

  // step 2: build the tx
  const tx = new bsv.Transaction().from(utxos)

  return tx
}
async function createLockingTx(address, amountInContract, lockingScript) {
  // step 1: fetch utxos
  let {
    data: utxos
  } = await axios.get(`${API_PREFIX}/address/${address}/unspent`)

  utxos = utxos.map((utxo) => ({
    txId: utxo.tx_hash,
    outputIndex: utxo.tx_pos,
    satoshis: utxo.value,
    script: bsv.Script.buildPublicKeyHashOut(address).toHex(),
  }))

  // step 2: build the tx
  const tx = new bsv.Transaction().from(utxos)
  tx.addOutput(new bsv.Transaction.Output({
    script: lockingScript,
    satoshis: amountInContract,
  }))
  tx.feePerKb(500)
  tx.change(address)

  return tx
}

async function fetchUtxoLargeThan(address, amount) {

  
}

async function anyOnePayforTx(tx, address, fee) {
  // step 1: fetch utxos
  let {
    data: utxos
  } = await axios.get(`${API_PREFIX}/address/${address}/unspent`)

  utxos.map(utxo => {
    tx.addInput(new bsv.Transaction.Input.PublicKeyHash({
      prevTxId:  utxo.tx_hash,
      outputIndex: utxo.tx_pos,
      script: new bsv.Script(), // placeholder
    }), bsv.Script.buildPublicKeyHashOut(address).toHex(), utxo.value)
  })

  if(fee) {
    tx.change(address).fee(fee)
  } else {
    tx.change(address)
  }

  return tx
}

function createUnlockingTx(prevTxId, inputAmount, inputLockingScript, outputAmount, outputLockingScript) {
  const tx = new bsv.Transaction()

  tx.addInput(new bsv.Transaction.Input({
    prevTxId,
    outputIndex: inputIndex,
    script: new bsv.Script(), // placeholder
  }), inputLockingScript, inputAmount)

  tx.addOutput(new bsv.Transaction.Output({
    script: outputLockingScript,
    satoshis: outputAmount,
  }))

  return tx
}

function unlockP2PKHInput(privateKey, tx, inputIndex, sigtype) {
  const sig = new bsv.Transaction.Signature({
    publicKey: privateKey.publicKey,
    prevTxId: tx.inputs[inputIndex].prevTxId,
    outputIndex: tx.inputs[inputIndex].outputIndex,
    inputIndex,
    signature: bsv.Transaction.Sighash.sign(tx, privateKey, sigtype,
      inputIndex,
      tx.inputs[inputIndex].output.script,
      tx.inputs[inputIndex].output.satoshisBN),
    sigtype,
  });

  tx.inputs[inputIndex].setScript(bsv.Script.buildPublicKeyHashIn(
    sig.publicKey,
    sig.signature.toDER(),
    sig.sigtype,
  ))
}

async function sendTx(tx) {
  const hex = tx.toString();

  const fee = tx.inputAmount - tx.outputAmount;

  const expectedFee = hex.length / 2 * 0.5;

  if(fee < expectedFee) {
    throw new Error(`Transaction with fee is too low: expected Fee is ${expectedFee}, but got ${fee}`)
  }

  try {
    const {
      data: txid
    } = await axios.post(`${API_PREFIX}/tx/raw`, {
      txhex: hex
    });
      
    return txid
  } catch (error) {
    if (error.response && error.response.data === '66: insufficient priority') {
      throw new Error(`Rejected by miner. Transaction with fee is too low: expected Fee is ${expectedFee}, but got ${fee}, hex: ${hex}`)
    } 
    throw error
  }

}

function compileContract(fileName, options) {
  const filePath = path.join(__dirname, 'contracts', fileName)
  const out = path.join(__dirname, 'out')

  const result = compileContractImpl(filePath, options ? options : {
    out: out
  });
  if (result.errors.length > 0) {
    console.log(`Compile contract ${filePath} failed: `, result.errors)
    throw result.errors;
  }

  return result;
}





function compileTestContract(fileName) {
  const filePath = path.join(__dirname, 'tests', 'testFixture', fileName)
  const out = path.join(__dirname, 'tests', 'out')
  if (!existsSync(out)) {
      mkdirSync(out)
  }
  const result = compileContractImpl(filePath, {
    out: out
  });
  if (result.errors.length > 0) {
    console.log(`Compile contract ${filePath} fail: `, result.errors)
    throw result.errors;
  }

  return result;
}

function loadDesc(fileName) {
  const filePath = path.join(__dirname, `out/${fileName}`);
  if (!existsSync(filePath)) {
    throw new Error(`Description file ${filePath} not exist!\nIf You already run 'npm run watch', maybe fix the compile error first!`)
  }
  return JSON.parse(readFileSync(filePath).toString());
}

function showError(error) {
  // Error
  if (error.response) {
    // The request was made and the server responded with a status code
    // that falls out of the range of 2xx
    console.log('Failed - StatusCodeError: ' + error.response.status + ' - "' + error.response.data + '"');
    // console.log(error.response.headers);
  } else if (error.request) {
    // The request was made but no response was received
    // `error.request` is an instance of XMLHttpRequest in the
    // browser and an instance of
    // http.ClientRequest in node.js
    console.log(error.request);
  } else {
    // Something happened in setting up the request that triggered an Error
    console.log('Error:', error.message);
    if (error.context) {
      console.log(error.context);
    }
  }
};

function padLeadingZero(hex) {
  if(hex.length % 2 === 0) return hex;
  return "0" + hex;
}

// fixLowS increments the first input's sequence number until the sig hash is safe for low s.
function fixLowS(tx, lockingScript, inputSatoshis, inputIndex) {
  for (i=0;i<25;i++) {
    const preimage = getPreimage(tx, lockingScript, inputSatoshis, inputIndex);
    const sighash = bsv.crypto.Hash.sha256sha256(Buffer.from(toHex(preimage), 'hex'));
    const msb = sighash.readUInt8();
    if (msb < MSB_THRESHOLD) {
      return;
    }
    tx.inputs[0].sequenceNumber++;
  }
}

// checkLowS returns true if the sig hash is safe for low s.
function checkLowS(tx, lockingScript, inputSatoshis, inputIndex) {
  const preimage = getPreimage(tx, lockingScript, inputSatoshis, inputIndex);
  const sighash = bsv.crypto.Hash.sha256sha256(Buffer.from(toHex(preimage), 'hex'));
  const msb = sighash.readUInt8();
  return (msb < MSB_THRESHOLD);
}


const sleep = async(seconds) => {
  return new Promise((resolve) => {
     setTimeout(() => {
        resolve();
     }, seconds * 1000);
  })
}

async function deployContract(contract, amountInContract) {
  // step 1: fetch utxos
  const address = privateKey.toAddress()
  let {
    data: utxos
  } = await axios.get(`${API_PREFIX}/address/${address}/unspent`)

  utxos = utxos.map((utxo) => ({
    txId: utxo.tx_hash,
    outputIndex: utxo.tx_pos,
    satoshis: utxo.value,
    script: bsv.Script.buildPublicKeyHashOut(address).toHex(),
  }))

  // step 2: build the tx
  const tx = new bsv.Transaction().from(utxos)
  tx.addOutput(new bsv.Transaction.Output({
    script: contract.lockingScript,
    satoshis: amountInContract,
  }))
  .change(address)
  .sign(privateKey)
  await sendTx(tx);
  return tx;
}

function createInputFromTx(tx, outputIndex) {
  return new bsv.Transaction.Input({
    prevTxId: tx.id,
    outputIndex: outputIndex || 0,
    script: new bsv.Script(), // placeholder
    output: tx.outputs[ outputIndex || 0]
  })
}

const emptyPublicKey = '000000000000000000000000000000000000000000000000000000000000000000'

module.exports = {
  inputIndex,
  inputSatoshis,
  sleep,
  newTx,
  createPayByOthersTx,
  createLockingTx,
  createUnlockingTx,
  DataLen,
  dummyTxId,
  reversedDummyTxId,
  reverseEndian,
  unlockP2PKHInput,
  sendTx,
  compileContract,
  loadDesc,
  sighashType2Hex,
  showError,
  compileTestContract,
  padLeadingZero,
  anyOnePayforTx,
  emptyPublicKey,
  fixLowS,
  checkLowS,
  deployContract,
  createInputFromTx
}
