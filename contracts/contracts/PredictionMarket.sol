// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PredictionMarket
/// @notice Small-group prediction market: anyone can propose an event with a
/// fixed set of outcomes, group members bet ETH on the outcome they think
/// will happen, the event creator resolves it once it's over, and winners
/// split the losing side's pool pari-mutuel style, proportional to stake.
contract PredictionMarket {
    struct Event {
        address creator;
        string question;
        string[] options;
        uint256 bettingDeadline;
        bool resolved;
        uint256 winningOption;
        uint256 totalPool;
        mapping(uint256 => uint256) optionPool; // optionIndex => total staked
        mapping(address => mapping(uint256 => uint256)) stakes; // user => optionIndex => amount
        mapping(address => bool) claimed;
    }

    // Mirrors Event but without mappings, for external reads.
    struct EventView {
        uint256 id;
        address creator;
        string question;
        string[] options;
        uint256 bettingDeadline;
        bool resolved;
        uint256 winningOption;
        uint256 totalPool;
        uint256[] optionPools;
    }

    uint256 public constant MAX_OPTIONS = 8;

    Event[] private events;

    event EventCreated(
        uint256 indexed eventId,
        address indexed creator,
        string question,
        string[] options,
        uint256 bettingDeadline
    );
    event BetPlaced(
        uint256 indexed eventId,
        address indexed bettor,
        uint256 indexed optionIndex,
        uint256 amount
    );
    event EventResolved(uint256 indexed eventId, uint256 winningOption);
    event WinningsClaimed(uint256 indexed eventId, address indexed bettor, uint256 amount);

    modifier eventExists(uint256 eventId) {
        require(eventId < events.length, "Event does not exist");
        _;
    }

    function createEvent(
        string calldata question,
        string[] calldata options,
        uint256 bettingDeadline
    ) external returns (uint256 eventId) {
        require(bytes(question).length > 0, "Question required");
        require(options.length >= 2, "Need at least 2 options");
        require(options.length <= MAX_OPTIONS, "Too many options");
        require(bettingDeadline > block.timestamp, "Deadline must be in the future");

        eventId = events.length;
        events.push();
        Event storage e = events[eventId];
        e.creator = msg.sender;
        e.question = question;
        e.bettingDeadline = bettingDeadline;
        for (uint256 i = 0; i < options.length; i++) {
            require(bytes(options[i]).length > 0, "Empty option");
            e.options.push(options[i]);
        }

        emit EventCreated(eventId, msg.sender, question, options, bettingDeadline);
    }

    function placeBet(uint256 eventId, uint256 optionIndex)
        external
        payable
        eventExists(eventId)
    {
        Event storage e = events[eventId];
        require(block.timestamp < e.bettingDeadline, "Betting closed");
        require(optionIndex < e.options.length, "Invalid option");
        require(msg.value > 0, "Must send ETH to bet");

        e.stakes[msg.sender][optionIndex] += msg.value;
        e.optionPool[optionIndex] += msg.value;
        e.totalPool += msg.value;

        emit BetPlaced(eventId, msg.sender, optionIndex, msg.value);
    }

    function resolveEvent(uint256 eventId, uint256 winningOption)
        external
        eventExists(eventId)
    {
        Event storage e = events[eventId];
        require(msg.sender == e.creator, "Only creator can resolve");
        require(!e.resolved, "Already resolved");
        require(block.timestamp >= e.bettingDeadline, "Betting still open");
        require(winningOption < e.options.length, "Invalid option");

        e.resolved = true;
        e.winningOption = winningOption;

        emit EventResolved(eventId, winningOption);
    }

    /// @notice Claim winnings for a resolved event. Pays out stake plus a
    /// proportional share of the losing pool. If nobody bet on the winning
    /// option, bettors get nothing back (pari-mutuel with no winners keeps
    /// the pool; there is no other claimant to pay).
    function claimWinnings(uint256 eventId) external eventExists(eventId) {
        Event storage e = events[eventId];
        require(e.resolved, "Event not resolved");
        require(!e.claimed[msg.sender], "Already claimed");

        uint256 userStake = e.stakes[msg.sender][e.winningOption];
        require(userStake > 0, "No winning stake to claim");

        uint256 winningPool = e.optionPool[e.winningOption];
        uint256 payout = (userStake * e.totalPool) / winningPool;

        e.claimed[msg.sender] = true;

        (bool success, ) = msg.sender.call{value: payout}("");
        require(success, "Transfer failed");

        emit WinningsClaimed(eventId, msg.sender, payout);
    }

    function eventCount() external view returns (uint256) {
        return events.length;
    }

    function getEvent(uint256 eventId) external view eventExists(eventId) returns (EventView memory) {
        Event storage e = events[eventId];
        uint256[] memory pools = new uint256[](e.options.length);
        for (uint256 i = 0; i < e.options.length; i++) {
            pools[i] = e.optionPool[i];
        }
        return EventView({
            id: eventId,
            creator: e.creator,
            question: e.question,
            options: e.options,
            bettingDeadline: e.bettingDeadline,
            resolved: e.resolved,
            winningOption: e.winningOption,
            totalPool: e.totalPool,
            optionPools: pools
        });
    }

    function getUserStakes(uint256 eventId, address user)
        external
        view
        eventExists(eventId)
        returns (uint256[] memory)
    {
        Event storage e = events[eventId];
        uint256[] memory stakes = new uint256[](e.options.length);
        for (uint256 i = 0; i < e.options.length; i++) {
            stakes[i] = e.stakes[user][i];
        }
        return stakes;
    }

    function hasClaimed(uint256 eventId, address user) external view eventExists(eventId) returns (bool) {
        return events[eventId].claimed[user];
    }
}
