// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDC} from "../contracts/MockUSDC.sol";

contract DeployMockUSDC is Script {
    function run() external {
        uint256 agentPk = vm.envUint("AGENT_PK"); // agent deploys → holds 1M USDC
        vm.startBroadcast(agentPk);
        MockUSDC usdc = new MockUSDC();
        vm.stopBroadcast();
        console.log("MockUSDC deployed at:", address(usdc));
        console.log("Set USDC_ADDRESS in .env to the above, then: npm run probe");
    }
}
