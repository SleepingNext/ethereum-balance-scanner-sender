const BigNumber = require("bignumber.js");
const dotenv = require("dotenv");
const {erc20ABI} = require("./abi");
const Web3 = require("web3");

dotenv.config();

const infuraAPIKey = process.env.INFURA_API_KEY.split(",");

let currentInfuraAPIKey = infuraAPIKey[0];

let web3 = new Web3(new Web3.providers.HttpProvider(`https://ropsten.infura.io/v3/${currentInfuraAPIKey}`)); // You will need to specify the INFURA_API_KEY (separate with "," if you got more than one API Key) in the .env file.

const to = ""; // Fill this variable with the receiver address.

const privateKeys = []; // Fill this array with the sender addresses.

const erc20s = [
    {contractAddress: "", minimumERC20Balance: ""},
]; // Fill this array with some objects that contain contract address of ERC20 token to be sent and its minimum ERC20 Balance (In Wei).

const fromFeePayer = ""; // Fill this variable with address of the fee payer.

const privateKeyFeePayer = ""; // Fill this variable with private key of the fee payer.

const minimumEtherBalance = ""; // Fill this variable with the minimum Ether balance for being able to be transferred (In Wei).

const manuallySetGasLimitSendEther = 0; // Fill this variable with the amount of gas limit you want each send Ether transaction to have.

const manuallySetGasPriceSendEther = 0; // Fill this variable with the amount of gas price you want each send Ether transaction to have in wei.

const manuallySetGasLimitSendERC20 = 0; // Fill this variable with the amount of gas limit you want each send ERC20 transaction to have.

const manuallySetGasPriceSendERC20 = 0; // Fill this variable with the amount of gas price you want each send ERC20 transaction to have in wei.

function weiToEther(amount) {
    return new BigNumber(amount).dividedBy(Math.pow(10, 18));
}

async function switchInfuraAPIKey() {
    const indexOfInfuraAPIKey = infuraAPIKey.indexOf(currentInfuraAPIKey);
    if (indexOfInfuraAPIKey !== -1 && indexOfInfuraAPIKey < infuraAPIKey.length - 1) currentInfuraAPIKey = infuraAPIKey[indexOfInfuraAPIKey + 1];
    else if (indexOfInfuraAPIKey !== -1 && indexOfInfuraAPIKey === infuraAPIKey.length - 1) currentInfuraAPIKey = infuraAPIKey[0];

    web3 = new Web3(new Web3.providers.HttpProvider(`https://ropsten.infura.io/v3/${currentInfuraAPIKey}`));
}

async function scanEtherBalances(privateKey) {
    try {
        const from = web3.eth.accounts.privateKeyToAccount(privateKey).address,
            amount = new BigNumber(await web3.eth.getBalance(from));

        if (amount.isGreaterThan(new BigNumber(minimumEtherBalance)))
            return {privateKey: privateKey, from: from, amount: amount.toFixed()};
        else return null;
    } catch (e) {
        if (e.message.includes("daily request count exceeded")) await switchInfuraAPIKey();
        return null;
    }
}

async function sendEther(response, manuallySetTo) {
    try {
        const count = await web3.eth.getTransactionCount(response.from);
        const estimatedGas = (manuallySetGasLimitSendEther !== 0) ? manuallySetGasLimitSendEther : await web3.eth.estimateGas({
            from: response.from, to: manuallySetTo ? manuallySetTo : to, value: response.amount,
        });
        const gasPrice = (manuallySetGasPriceSendEther !== 0) ? manuallySetGasPriceSendEther : await web3.eth.getGasPrice();

        if (!manuallySetTo) {
            const fee = new BigNumber(estimatedGas).multipliedBy(new BigNumber(gasPrice));
            response.amount = new BigNumber(response.amount).minus(fee).toFixed();
        }

        const signedTx = await web3.eth.accounts.signTransaction({
                from: response.from, to: manuallySetTo ? manuallySetTo : to, gas: new BigNumber(estimatedGas).toFixed(),
                nonce: count, value: response.amount, gasPrice: new BigNumber(gasPrice).toFixed(),
            }, response.privateKey,
        );

        console.log(`Sending ${weiToEther(response.amount)} Ether from ${response.from} to ${manuallySetTo ? manuallySetTo : to}. Transaction ID: ${signedTx.transactionHash}.`);

        await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

        return signedTx.transactionHash;
    } catch (e) {
        if (e.message.includes("daily request count exceeded")) await switchInfuraAPIKey();
        console.log(e);
    }
}

async function sendEtherBalances() {
    const tasks = [];
    for (const privateKey of privateKeys) tasks.push(scanEtherBalances(privateKey));

    const responses = await Promise.all(tasks);
    for (const response of responses) if (response != null) await sendEther(response);
}

async function scanERC20Balances(contract, privateKey, minimumERC20Balance) {
    try {
        const from = web3.eth.accounts.privateKeyToAccount(privateKey).address;
        let amount = new BigNumber(await contract.methods.balanceOf(from).call());

        if (amount.isGreaterThan(new BigNumber(minimumERC20Balance)))
            return {privateKey: privateKey, from: from, amount: amount.toFixed()};
        else return null;
    } catch (e) {
        if (e.message.includes("daily request count exceeded")) await switchInfuraAPIKey();
        return null;
    }
}

async function sendERC20(response, contractAddress) {
    try {
        const contract = new web3.eth.Contract(erc20ABI, contractAddress),
            data = contract.methods.transfer(to, response.amount).encodeABI();

        const count = await web3.eth.getTransactionCount(response.from);
        const estimatedGas = (manuallySetGasLimitSendERC20 !== 0) ? manuallySetGasLimitSendERC20 : await web3.eth.estimateGas({from: response.from, to: contractAddress, value: "0x00", data: data});
        const gasPrice = (manuallySetGasPriceSendERC20 !== 0) ? manuallySetGasPriceSendERC20 : await web3.eth.getGasPrice();

        const fee = new BigNumber(estimatedGas).multipliedBy(new BigNumber(gasPrice)),
            etherAmount = new BigNumber(await web3.eth.getBalance(response.from));

        if (etherAmount.isLessThan(fee)) {
            const txid = await sendEther({
                privateKey: privateKeyFeePayer, from: fromFeePayer, amount: fee.toFixed(),
            }, response.from);

            const receipt = await web3.eth.getTransactionReceipt(txid);
            if (!receipt || !receipt.status) return;
        }

        const signedTx = await web3.eth.accounts.signTransaction({
                from: response.from, to: contractAddress, gas: new BigNumber(estimatedGas).toFixed(),
                nonce: count, value: "0x00", data: data, gasPrice: new BigNumber(gasPrice).toFixed(),
            }, response.privateKey,
        );

        console.log(`Sending ERC20 from ${response.from} to ${to}. Transaction ID: ${signedTx.transactionHash}.`);

        await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    } catch (e) {
        console.log(e);
    }
}

async function sendERC20Balances() {
    for (const erc20 of erc20s) {
        const contract = new web3.eth.Contract(erc20ABI, erc20.contractAddress), tasks = [];
        for (const privateKey of privateKeys) tasks.push(scanERC20Balances(contract, privateKey, erc20.minimumERC20Balance));

        const responses = await Promise.all(tasks);
        for (const response of responses) if (response != null) await sendERC20(response, erc20.contractAddress);
    }
}

async function scanAsset() {
    console.log("Listening for balance update...");

    while (true) {
        await sendERC20Balances();
        await sendEtherBalances();
    }
}

scanAsset().then();