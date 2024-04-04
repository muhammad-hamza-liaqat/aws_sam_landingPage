import { StatusCodes } from "http-status-codes";
import {
  DBConn,
  HTTPError,
  HTTPResponse,
  catchTryAsyncErrors,
} from "./utils/helper.mjs";
import { ObjectId } from "mongodb";

export const handler = async (event) => {
  try {
    const method = event.httpMethod;
    const path = event.path;
    const queryParams = event.queryStringParameters || {};
    const body = JSON.parse(event.body || "{}");

    const client = await DBConn();
    const DB = client.db("10D");

    switch (method) {
      case "GET":
        if (path === "/getChainsList") {
          // return await getChainsList(queryParams, DB);
          return catchTryAsyncErrors(getChainsList)(queryParams, DB);
        } else if (path === "/getMediaList") {
          return await getMediaList(queryParams, DB);
        } else if (path === "/getTopNodes") {
          return await getTopNodesAcrossChains(queryParams, DB);
        }
        break;
      case "POST":
        if (path === "/searchNodes") {
          return await searchNodes(queryParams, DB);
        }
        break;
      default:
        return {
          statusCode: StatusCodes.METHOD_NOT_ALLOWED,
          body: JSON.stringify({
            message: "Endpoint not allowed",
          }),
        };
    }
  } catch (error) {
    console.error("An error occurred:", error);
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ message: "Something Went Wrong", error: error }),
    };
  }
};

const getChainsList = async (queryParams, DB) => {
  const page = Number(queryParams.page) || 1;
  const limit = Number(queryParams.limit) || 10;
  const skip = (page - 1) * limit;

  const chains = await DB.collection("chains")
    .aggregate([{ $skip: skip }, { $limit: limit }])
    .toArray();

  const totalChainsCount = await DB.collection("chains").countDocuments();

  let totalInvestment = 0;
  for (const chain of chains) {
    const collectionName = `treeNodes${chain.name}`;
    const firstNode = await DB.collection(collectionName).findOne({
      _id: chain.rootNode,
    });
    const totalMembers = firstNode.totalMembers;
    const chainInvestment = totalMembers * chain.seedAmount;
    chain.investment = chainInvestment;
    totalInvestment += chainInvestment;
  }

  return {
    statusCode: StatusCodes.OK,
    body: JSON.stringify({
      message: "Success",
      chains: chains,
      count: totalChainsCount,
      totalInvestment: totalInvestment,
    }),
  };
};

const getMediaList = async (queryParams, DB) => {
  try {
    const media = await DB.collection("media").findOne({});
    console.log("media", media);

    if (!media) {
      return {
        statusCode: StatusCodes.NOT_FOUND,
        body: JSON.stringify({ message: "Media record not found" }),
      };
    }

    return {
      statusCode: StatusCodes.OK,
      body: JSON.stringify({
        message: "Media record fetched successfully",
        media: media,
      }),
    };
  } catch (error) {
    console.error("An error occurred:", error);
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ message: "Something Went Wrong", error: error }),
    };
  }
};

const getTopNodesAcrossChains = async (queryParams, DB) => {
  try {
    const chainNames = await DB.collection("chains").distinct("name");

    if (!chainNames || chainNames.length === 0) {
      return {
        statusCode: StatusCodes.NOT_FOUND,
        body: JSON.stringify({ message: "Chain not found" }),
      };
    }

    const pipeline = chainNames.slice(1).reduce((acc, chainName) => {
      acc.push({
        $unionWith: { coll: "treeNodes" + chainName },
      });
      return acc;
    }, []);

    pipeline.push(
      {
        $sort: { totalMembers: -1 },
      },
      {
        $limit: 10,
      }
    );

    const paginatedNodes = await DB.collection(chainNames[0])
      .aggregate(pipeline)
      .toArray();

    return {
      statusCode: StatusCodes.OK,
      body: JSON.stringify({
        message: "Top nodes across all chains fetched successfully!",
        paginatedNodes: paginatedNodes,
      }),
    };
  } catch (error) {
    console.error("An error occurred:", error);
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ message: "Something Went Wrong", error: error }),
    };
  }
};

const searchNodes = async (queryParams, DB) => {
  try {
    const searchField = queryParams.searchField;
    const page = Number(queryParams.page) || 1;
    const limit = Number(queryParams.limit) || 10;
    const skip = (page - 1) * limit;

    if (!searchField) {
      return {
        statusCode: StatusCodes.BAD_REQUEST,
        body: JSON.stringify({ message: "SearchField required" }),
      };
    }

    const chainNames = await DB.collection("chains").distinct("name");

    if (!chainNames.length) {
      return {
        statusCode: StatusCodes.NOT_FOUND,
        body: JSON.stringify({ message: "Chains not found" }),
      };
    }

    const pipeline = chainNames.slice(1).flatMap((chainName) => [
      {
        $unionWith: { coll: "treeNodes" + chainName },
      },
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "userData",
        },
      },
      {
        $unwind: "$userData",
      },
      {
        $match: {
          $or: [
            { "userData.userName": { $regex: new RegExp(searchField, "i") } },
            { nodeId: parseInt(searchField) },
          ],
        },
      },
      { $skip: skip },
      { $limit: limit },
    ]);

    const nodes = await DB.collection(chainNames[0])
      .aggregate(pipeline)
      .toArray();

    if (!nodes.length) {
      return {
        statusCode: StatusCodes.NOT_FOUND,
        body: JSON.stringify({ message: "Nodes not found" }),
      };
    }

    return {
      statusCode: StatusCodes.OK,
      body: JSON.stringify({ message: "Nodes fetched successfully", nodes }),
    };
  } catch (error) {
    console.error("An error occurred:", error);
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ message: "Something Went Wrong", error: error }),
    };
  }
};
