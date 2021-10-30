const { buildContractClass, bsv } = require('scryptlib');
const { loadDesc, showError, deployContract, sendTx, createInputFromTx } = require('../helper');
const { privateKey } = require('../privateKey');

(async() => {
    try {
        const amount = 1000
        const newAmount = 546

        // get locking script
        const Demo = buildContractClass(loadDesc('demo_debug_desc.json'));
        demo = new Demo(4, 7);
        
        // lock fund to the script
        const tx =  await deployContract(demo, amount);
        console.log('locking txid:     ', tx.id)

        const unlockingTx = new bsv.Transaction();
        unlockingTx.addInput(createInputFromTx(tx)) 
        .change(privateKey.toAddress())
        .setInputScript(0, (self, prevLockingScript, satoshis) => {
            return demo.add(11).toScript();
        });
        
        // unlock
        await sendTx(unlockingTx)

        console.log('unlocking txid:   ', unlockingTx.id)

        console.log('Succeeded on testnet')
    } catch (error) {
        console.log('Failed on testnet')
        showError(error)
    }
})()