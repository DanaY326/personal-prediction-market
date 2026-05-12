const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("PredictionMarket", function () {
  async function deployFixture() {
    const [creator, alice, bob, carol] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("PredictionMarket");
    const market = await Factory.deploy();
    const deadline = (await time.latest()) + 3600; // 1 hour from now
    return { market, creator, alice, bob, carol, deadline };
  }

  it("creates an event", async function () {
    const { market, creator, deadline } = await deployFixture();
    await expect(
      market.connect(creator).createEvent("Who wins the game?", ["Team A", "Team B"], deadline)
    )
      .to.emit(market, "EventCreated")
      .withArgs(0, creator.address, "Who wins the game?", ["Team A", "Team B"], deadline);

    expect(await market.eventCount()).to.equal(1);
    const ev = await market.getEventDetails(0);
    expect(ev.question).to.equal("Who wins the game?");
    expect(ev.options).to.deep.equal(["Team A", "Team B"]);
    expect(ev.resolved).to.equal(false);
  });

  it("rejects invalid event creation", async function () {
    const { market, creator, deadline } = await deployFixture();
    await expect(
      market.connect(creator).createEvent("", ["A", "B"], deadline)
    ).to.be.revertedWith("Question required");
    await expect(
      market.connect(creator).createEvent("Q?", ["A"], deadline)
    ).to.be.revertedWith("Need at least 2 options");
    await expect(
      market.connect(creator).createEvent("Q?", ["A", "B"], (await time.latest()) - 1)
    ).to.be.revertedWith("Deadline must be in the future");
  });

  it("accepts bets and tracks pools", async function () {
    const { market, creator, alice, bob, deadline } = await deployFixture();
    await market.connect(creator).createEvent("Q?", ["Yes", "No"], deadline);

    await expect(market.connect(alice).placeBet(0, 0, { value: ethers.parseEther("1") }))
      .to.emit(market, "BetPlaced")
      .withArgs(0, alice.address, 0, ethers.parseEther("1"));
    await market.connect(bob).placeBet(0, 1, { value: ethers.parseEther("2") });

    const ev = await market.getEventDetails(0);
    expect(ev.totalPool).to.equal(ethers.parseEther("3"));
    expect(ev.optionPools[0]).to.equal(ethers.parseEther("1"));
    expect(ev.optionPools[1]).to.equal(ethers.parseEther("2"));
  });

  it("rejects bets with no ETH, bad option, or after deadline", async function () {
    const { market, creator, alice, deadline } = await deployFixture();
    await market.connect(creator).createEvent("Q?", ["Yes", "No"], deadline);

    await expect(
      market.connect(alice).placeBet(0, 0, { value: 0 })
    ).to.be.revertedWith("Must send ETH to bet");
    await expect(
      market.connect(alice).placeBet(0, 5, { value: 1 })
    ).to.be.revertedWith("Invalid option");

    await time.increaseTo(deadline + 1);
    await expect(
      market.connect(alice).placeBet(0, 0, { value: 1 })
    ).to.be.revertedWith("Betting closed");
  });

  it("only lets the creator resolve, and only after the deadline", async function () {
    const { market, creator, alice, deadline } = await deployFixture();
    await market.connect(creator).createEvent("Q?", ["Yes", "No"], deadline);

    await expect(market.connect(alice).resolveEvent(0, 0)).to.be.revertedWith(
      "Only creator can resolve"
    );
    await expect(market.connect(creator).resolveEvent(0, 0)).to.be.revertedWith(
      "Betting still open"
    );

    await time.increaseTo(deadline + 1);
    await expect(market.connect(creator).resolveEvent(0, 0))
      .to.emit(market, "EventResolved")
      .withArgs(0, 0);

    await expect(market.connect(creator).resolveEvent(0, 0)).to.be.revertedWith(
      "Already resolved"
    );
  });

  it("pays out winners proportionally and blocks double claims", async function () {
    const { market, creator, alice, bob, carol, deadline } = await deployFixture();
    await market.connect(creator).createEvent("Q?", ["Yes", "No"], deadline);

    // Alice and Bob bet Yes (1 and 3 ETH), Carol bets No (4 ETH). Pool = 8 ETH.
    await market.connect(alice).placeBet(0, 0, { value: ethers.parseEther("1") });
    await market.connect(bob).placeBet(0, 0, { value: ethers.parseEther("3") });
    await market.connect(carol).placeBet(0, 1, { value: ethers.parseEther("4") });

    await time.increaseTo(deadline + 1);
    await market.connect(creator).resolveEvent(0, 0); // Yes wins

    const aliceBefore = await ethers.provider.getBalance(alice.address);
    const tx = await market.connect(alice).claimWinnings(0);
    const receipt = await tx.wait();
    const gasCost = receipt.gasUsed * receipt.gasPrice;
    const aliceAfter = await ethers.provider.getBalance(alice.address);

    // Alice staked 1/4 of the winning pool -> 1/4 of the 8 ETH total pool = 2 ETH
    const expectedPayout = ethers.parseEther("2");
    expect(aliceAfter + gasCost - aliceBefore).to.equal(expectedPayout);

    await expect(market.connect(alice).claimWinnings(0)).to.be.revertedWith(
      "Already claimed"
    );

    // Carol bet on the losing option and has nothing to claim.
    await expect(market.connect(carol).claimWinnings(0)).to.be.revertedWith(
      "No winning stake to claim"
    );

    // Bob claims his 3/4 share -> 6 ETH.
    await expect(market.connect(bob).claimWinnings(0)).to.changeEtherBalance(
      bob,
      ethers.parseEther("6")
    );
  });

  it("rejects claims before resolution", async function () {
    const { market, creator, alice, deadline } = await deployFixture();
    await market.connect(creator).createEvent("Q?", ["Yes", "No"], deadline);
    await market.connect(alice).placeBet(0, 0, { value: ethers.parseEther("1") });

    await expect(market.connect(alice).claimWinnings(0)).to.be.revertedWith(
      "Event not resolved"
    );
  });
});
