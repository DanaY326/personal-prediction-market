const { ethers } = require("hardhat");

async function main() {
  const [creator, alice, bob] = await ethers.getSigners();

  const Factory = await ethers.getContractFactory("PredictionMarket");
  const market = await Factory.deploy();
  await market.waitForDeployment();
  console.log(`PredictionMarket deployed to: ${await market.getAddress()}`);

  const deadline = Math.floor(Date.now() / 1000) + 3600;
  await market.connect(creator).createEvent("Who wins the game?", ["Team A", "Team B"], deadline);
  console.log("Created event 0: 'Who wins the game?' (Team A vs Team B)");

  await market.connect(alice).placeBet(0, 0, { value: ethers.parseEther("1") });
  console.log(`Alice (${alice.address}) bet 1 mock ETH on Team A`);

  await market.connect(bob).placeBet(0, 1, { value: ethers.parseEther("2") });
  console.log(`Bob (${bob.address}) bet 2 mock ETH on Team B`);

  const ev = await market.getEventDetails(0);
  console.log(`Total pool: ${ethers.formatEther(ev.totalPool)} mock ETH`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
