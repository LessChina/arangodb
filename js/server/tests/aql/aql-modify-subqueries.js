/*jshint globalstrict:false, strict:false, maxlen: 500 */
/*global assertEqual, assertNotEqual, assertTrue, assertFalse, assertNull, assertMatch, fail, AQL_EXECUTE, AQL_EXPLAIN */

////////////////////////////////////////////////////////////////////////////////
/// @brief tests for query language, bind parameters
///
/// @file
///
/// DISCLAIMER
///
/// Copyright 2010-2012 triagens GmbH, Cologne, Germany
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///
/// Copyright holder is triAGENS GmbH, Cologne, Germany
///
/// @author Jan Steemann
/// @author Copyright 2012, triAGENS GmbH, Cologne, Germany
////////////////////////////////////////////////////////////////////////////////

const internal = require("internal");
const db = require("@arangodb").db;
const jsunity = require("jsunity");
const helper = require("@arangodb/aql-helper");
const getModifyQueryResultsRaw = helper.getModifyQueryResultsRaw;
const assertQueryError = helper.assertQueryError;
const _ = require('lodash');
const isCluster = require('@arangodb/cluster').isCluster();
const disableSingleDocOp = { optimizer : { rules : [ "-optimize-cluster-single-document-operations" ] } };
const disableRestrictToSingleShard = { optimizer : { rules : [ "-restrict-to-single-shard" ] } };

const disableSingleDocOpRestrictToSingleShard = {
  optimizer : {
    rules : [
      "-restrict-to-single-shard",
      "-optimize-cluster-single-document-operations"
    ]
  }
};

var sanitizeStats = function (stats) {
  // remove these members from the stats because they don't matter
  // for the comparisons
  delete stats.scannedFull;
  delete stats.scannedIndex;
  delete stats.filtered;
  delete stats.executionTime;
  delete stats.httpRequests;
  delete stats.fullCount;
  return stats;
};

let hasDistributeNode = function(nodes) {
  return (nodes.filter(function(node) {
    return node.type === 'DistributeNode';
  }).length > 0);
};

let allNodesOfTypeAreRestrictedToShard = function(nodes, typeName, collection) {
  return nodes.filter(function(node) {
    return node.type === typeName;
  }).every(function(node) {
    return (collection.shards().indexOf(node.restrictedTo) !== -1);
  });
};

////////////////////////////////////////////////////////////////////////////////
/// @brief test suite
////////////////////////////////////////////////////////////////////////////////

function ahuacatlModifySuite () {
  var errors = internal.errors;
  var cn = "UnitTestsAhuacatlModify";

  return {

    setUp : function () {
      db._drop(cn);
    },

    tearDown : function () {
      db._drop(cn);
    },

    // use default shard key (_key)

    testUpdateSingle : function () {
      if (!isCluster) {
        return;
      }
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      { // no - RestrictToSingleShard
        let key = c.insert({ id: "test", value: 1 })._key;

        let expected = { writesExecuted: 1, writesIgnored: 0 };
        let query = "UPDATE { _key: " + JSON.stringify(key) + ", id: 'test' } WITH { value: 2 } IN " + cn;
        let actual = getModifyQueryResultsRaw(query, {}, disableSingleDocOpRestrictToSingleShard);

        let plan = AQL_EXPLAIN(query, {}, disableSingleDocOpRestrictToSingleShard).plan;

        //assertTrue(hasDistributeNode(plan.nodes)); // the distribute node is not required here
        assertFalse(allNodesOfTypeAreRestrictedToShard(plan.nodes, 'UpdateNode', c));
        assertEqual(-1, plan.rules.indexOf("restrict-to-single-shard"));

        assertEqual(1, c.count());
        assertEqual(0, actual.json.length);
        assertEqual(expected, sanitizeStats(actual.stats));
        c.truncate();
      }

      // RestrictToSingleShard
      let key = c.insert({ id: "test", value: 1 })._key;

      let expected = { writesExecuted: 1, writesIgnored: 0 };
      let query = "UPDATE { _key: " + JSON.stringify(key) + ", id: 'test' } WITH { value: 2 } IN " + cn;
      let actual = getModifyQueryResultsRaw(query, {}, disableSingleDocOp);

      let plan = AQL_EXPLAIN(query, {}, disableSingleDocOp).plan;

      assertFalse(hasDistributeNode(plan.nodes));
      assertTrue(allNodesOfTypeAreRestrictedToShard(plan.nodes, 'UpdateNode', c));
      assertNotEqual(-1, plan.rules.indexOf("restrict-to-single-shard"));

      assertEqual(1, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testUpdateSingleShardKeyChange : function () {
      if (!isCluster) {
        return;
      }

      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});
      let key = c.insert({ id: "test", value: 1 })._key;

      assertQueryError(errors.ERROR_CLUSTER_MUST_NOT_CHANGE_SHARDING_ATTRIBUTES.code, "UPDATE { _key: " + JSON.stringify(key) + ", id: 'test' } WITH { value: 2, id: 'bark' } IN " + cn);
    },

    testReplaceSingle : function () {
      if (!isCluster) {
        return;
      }
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});
      { // no - RestrictToSingleShard
        let key = c.insert({ id: "test", value: 1 })._key;

        let expected = { writesExecuted: 1, writesIgnored: 0 };
        let query = "REPLACE { _key: " + JSON.stringify(key) + ", id: 'test' } WITH { id: 'test', value: 2 } IN " + cn;
        let actual = getModifyQueryResultsRaw(query, {}, disableSingleDocOpRestrictToSingleShard);

        let plan = AQL_EXPLAIN(query, {}, disableSingleDocOpRestrictToSingleShard).plan;
        assertTrue(hasDistributeNode(plan.nodes));
        assertFalse(allNodesOfTypeAreRestrictedToShard(plan.nodes, 'ReplaceNode', c));
        assertEqual(-1, plan.rules.indexOf("restrict-to-single-shard"));
        c.truncate();
      }

      // RestrictToSingleShard
      let key = c.insert({ id: "test", value: 1 })._key;

      let expected = { writesExecuted: 1, writesIgnored: 0 };
      let query = "REPLACE { _key: " + JSON.stringify(key) + ", id: 'test' } WITH { id: 'test', value: 2 } IN " + cn;
      let actual = getModifyQueryResultsRaw(query, {}, disableSingleDocOp);

      let plan = AQL_EXPLAIN(query, {}, disableSingleDocOp).plan;
      assertFalse(hasDistributeNode(plan.nodes));
      assertTrue(allNodesOfTypeAreRestrictedToShard(plan.nodes, 'ReplaceNode', c));
      assertNotEqual(-1, plan.rules.indexOf("restrict-to-single-shard"));

      assertEqual(1, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testReplaceSingleShardKeyChange : function () {
      if (!isCluster) {
        return;
      }

      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});
      let key = c.insert({ id: "test", value: 1 })._key;

      assertQueryError(errors.ERROR_CLUSTER_MUST_NOT_CHANGE_SHARDING_ATTRIBUTES.code, "REPLACE { _key: " + JSON.stringify(key) + ", id: 'test' } WITH { value: 2, id: 'bark' } IN " + cn);
    },

    testInsertMainLevelWithCustomShardKeyConstant : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      // no - RestrictToSingleShard
      for (let i = 0; i < 30; ++i) {
        let expected = { writesExecuted: 1, writesIgnored: 0 };
        let query = "INSERT { value: " + i + ", id: 'test" + i + "' } IN " + cn;
        let actual = getModifyQueryResultsRaw(query, {}, disableSingleDocOpRestrictToSingleShard);

        if (isCluster) {
          let plan = AQL_EXPLAIN(query, {}, disableSingleDocOpRestrictToSingleShard).plan;
          assertTrue(hasDistributeNode(plan.nodes));
          assertEqual(-1, plan.rules.indexOf("restrict-to-single-shard"));
        }

        assertEqual(0, actual.json.length);
        assertEqual(expected, sanitizeStats(actual.stats));
      }
      assertEqual(30, c.count());
      c.truncate();

      // RestrictToSingleShard
      for (let i = 0; i < 30; ++i) {
        let expected = { writesExecuted: 1, writesIgnored: 0 };
        let query = "INSERT { value: " + i + ", id: 'test" + i + "' } IN " + cn;
        let actual = getModifyQueryResultsRaw(query, {}, disableSingleDocOp);

        if (isCluster) {
          let plan = AQL_EXPLAIN(query,{}, disableSingleDocOp).plan;
          assertFalse(hasDistributeNode(plan.nodes));
          assertNotEqual(-1, plan.rules.indexOf("restrict-to-single-shard"));
        }

        assertEqual(0, actual.json.length);
        assertEqual(expected, sanitizeStats(actual.stats));
      }
      assertEqual(30, c.count());

      for (let i = 0; i < 30; ++i) {
        let r = db._query("FOR doc IN " + cn + " FILTER doc.id == 'test" + i + "' RETURN doc").toArray();
        assertEqual(1, r.length);
        assertEqual("test" + i, r[0].id);
      }
    },

    testInsertMainLevelWithCustomShardKeyMultiLevel : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["a.b"]});

      // no - RestrictToSingleShard
      for (let i = 0; i < 30; ++i) {
        let expected = { writesExecuted: 1, writesIgnored: 0 };
        let query = "INSERT { value: " + i + ", a: { b: 'test" + i + "' } } IN " + cn;
        let actual = getModifyQueryResultsRaw(query, {}, disableSingleDocOp);

        if (isCluster) {
          let plan = AQL_EXPLAIN(query,{}, disableSingleDocOp).plan;
          assertTrue(hasDistributeNode(plan.nodes));
          assertEqual(-1, plan.rules.indexOf("restrict-to-single-shard"));
        }

        assertEqual(0, actual.json.length);
        assertEqual(expected, sanitizeStats(actual.stats));
      }
      assertEqual(30, c.count());
      c.truncate();

      // RestrictToSingleShard
      for (let i = 0; i < 30; ++i) {
        let expected = { writesExecuted: 1, writesIgnored: 0 };
        let query = "INSERT { value: " + i + ", a: { b: 'test" + i + "' } } IN " + cn;
        let actual = getModifyQueryResultsRaw(query, {}, disableSingleDocOp);

        if (isCluster) {
          let plan = AQL_EXPLAIN(query, {}, disableSingleDocOp).plan;
          assertTrue(hasDistributeNode(plan.nodes));
          assertEqual(-1, plan.rules.indexOf("restrict-to-single-shard"));
        }

        assertEqual(0, actual.json.length);
        assertEqual(expected, sanitizeStats(actual.stats));
      }
      assertEqual(30, c.count());

      for (let i = 0; i < 30; ++i) {
        let r = db._query("FOR doc IN " + cn + " FILTER doc.a.b == 'test" + i + "' RETURN doc").toArray();
        assertEqual(1, r.length);
        assertEqual("test" + i, r[0].a.b);
      }
    },

    testInsertMainLevelWithKeyConstant : function () {
      let c = db._create(cn, {numberOfShards:5});
      // no - RestrictToSingleShard
      for (let i = 0; i < 30; ++i) {
        let expected = { writesExecuted: 1, writesIgnored: 0 };
        let query = "INSERT { value: " + i + ", _key: 'test" + i + "' } IN " + cn;
        let actual = getModifyQueryResultsRaw(query, {}, disableSingleDocOpRestrictToSingleShard);

        if (isCluster) {
          let plan = AQL_EXPLAIN(query, {}, disableSingleDocOpRestrictToSingleShard).plan;
          assertTrue(hasDistributeNode(plan.nodes));
          assertEqual(-1, plan.rules.indexOf("restrict-to-single-shard"));
        }

        assertEqual(0, actual.json.length);
        assertEqual(expected, sanitizeStats(actual.stats));
      }
      assertEqual(30, c.count());

      for (let i = 0; i < 30; ++i) {
        let r = db._query("FOR doc IN " + cn + " FILTER doc._key == 'test" + i + "' RETURN doc").toArray();
        assertEqual(1, r.length);
        assertEqual("test" + i, r[0]._key);
        assertEqual(cn + "/test" + i, r[0]._id);

        r = db._query("FOR doc IN " + cn + " FILTER doc._id == '" + cn + "/test" + i + "' RETURN doc").toArray();
        assertEqual(1, r.length);
        assertEqual("test" + i, r[0]._key);
        assertEqual(cn + "/test" + i, r[0]._id);
      }
      c.truncate();

      // RestrictToSingleShard
      for (let i = 0; i < 30; ++i) {
        let expected = { writesExecuted: 1, writesIgnored: 0 };
        let query = "INSERT { value: " + i + ", _key: 'test" + i + "' } IN " + cn;
        let actual = getModifyQueryResultsRaw(query, {}, disableSingleDocOp);

        if (isCluster) {
          let plan = AQL_EXPLAIN(query,{}, disableSingleDocOp).plan;
          assertFalse(hasDistributeNode(plan.nodes));
          assertNotEqual(-1, plan.rules.indexOf("restrict-to-single-shard"));
        }

        assertEqual(0, actual.json.length);
        assertEqual(expected, sanitizeStats(actual.stats));
      }
      assertEqual(30, c.count());

      for (let i = 0; i < 30; ++i) {
        let r = db._query("FOR doc IN " + cn + " FILTER doc._key == 'test" + i + "' RETURN doc").toArray();
        assertEqual(1, r.length);
        assertEqual("test" + i, r[0]._key);
        assertEqual(cn + "/test" + i, r[0]._id);

        r = db._query("FOR doc IN " + cn + " FILTER doc._id == '" + cn + "/test" + i + "' RETURN doc").toArray();
        assertEqual(1, r.length);
        assertEqual("test" + i, r[0]._key);
        assertEqual(cn + "/test" + i, r[0]._id);
      }
    },

    testInsertMainLevelWithKeyExpression : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 30; ++i) {
        let expected = { writesExecuted: 1, writesIgnored: 0 };
        let query = "INSERT { value: " + i + ", _key: NOOPT(CONCAT('test', '" + i + "')) } IN " + cn;
        let actual = getModifyQueryResultsRaw(query, {}, disableSingleDocOp);

        if (isCluster) {
          let plan = AQL_EXPLAIN(query,{}, disableSingleDocOp).plan;
          assertTrue(hasDistributeNode(plan.nodes));
          assertEqual(-1, plan.rules.indexOf("restrict-to-single-shard"));
        }

        assertEqual(0, actual.json.length);
        assertEqual(expected, sanitizeStats(actual.stats));
      }
      assertEqual(30, c.count());

      for (let i = 0; i < 30; ++i) {
        let r = db._query("FOR doc IN " + cn + " FILTER doc._key == 'test" + i + "' RETURN doc").toArray();
        assertEqual(1, r.length);
        assertEqual("test" + i, r[0]._key);
        assertEqual(cn + "/test" + i, r[0]._id);

        r = db._query("FOR doc IN " + cn + " FILTER doc._id == '" + cn + "/test" + i + "' RETURN doc").toArray();
        assertEqual(1, r.length);
        assertEqual("test" + i, r[0]._key);
        assertEqual(cn + "/test" + i, r[0]._id);
      }
    },

    testInsertMainLevelWithKey : function () {
      let c = db._create(cn, {numberOfShards:5});

      let expected = { writesExecuted: 2000, writesIgnored: 0 };
      let query = "FOR i IN 1..2000 INSERT { value: i, _key: CONCAT('test', i) } IN " + cn;
      { // no - RestrictToSingleShard
        let actual = getModifyQueryResultsRaw(query);

        if (isCluster) {
          let nodes = AQL_EXPLAIN(query, {}, disableRestrictToSingleShard).plan.nodes;
          assertTrue(hasDistributeNode(nodes));
        }

        assertEqual(2000, c.count());
        assertEqual(0, actual.json.length);
        assertEqual(expected, sanitizeStats(actual.stats));
        c.truncate();
      }
      // RestrictToSingleShard
      let actual = getModifyQueryResultsRaw(query);

      if (isCluster) {
        let nodes = AQL_EXPLAIN(query).plan.nodes;
        assertTrue(hasDistributeNode(nodes));
      }

      assertEqual(2000, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testInsertMainLevelWithKeyReturnNew : function () {
      let c = db._create(cn, {numberOfShards:5});

      let expected = { writesExecuted: 2000, writesIgnored: 0 };
      let query = "FOR i IN 1..2000 INSERT { value: i, _key: CONCAT('test', i) } IN " + cn +  " RETURN NEW";
      let actual = getModifyQueryResultsRaw(query);

      if (isCluster) {
        let nodes = AQL_EXPLAIN(query).plan.nodes;
        assertTrue(hasDistributeNode(nodes));
      }

      assertEqual(2000, c.count());
      assertEqual(2000, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testInsertMainLevelCustomShardKey : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      let expected = { writesExecuted: 2000, writesIgnored: 0 };
      let query = "FOR i IN 1..2000 INSERT { value: i, id: i } IN " + cn;
      let actual = getModifyQueryResultsRaw(query);

      if (isCluster) {
        let nodes = AQL_EXPLAIN(query).plan.nodes;
        assertTrue(hasDistributeNode(nodes));
      }

      assertEqual(2000, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testInsertMainLevelCustomShardKeyReturnNew : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      let expected = { writesExecuted: 2000, writesIgnored: 0 };
      let query = "FOR i IN 1..2000 INSERT { value: i, id: i } IN " + cn + " RETURN NEW";
      let actual = getModifyQueryResultsRaw(query);

      if (isCluster) {
        let nodes = AQL_EXPLAIN(query).plan.nodes;
        assertTrue(hasDistributeNode(nodes));
      }

      assertEqual(2000, c.count());
      assertEqual(2000, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testInsertMainLevel : function () {
      let c = db._create(cn, {numberOfShards:5});

      let expected = { writesExecuted: 2000, writesIgnored: 0 };
      let query = "FOR i IN 1..2000 INSERT { value: i } IN " + cn;
      let actual = getModifyQueryResultsRaw(query);

      if (isCluster) {
        let nodes = AQL_EXPLAIN(query).plan.nodes;
        assertTrue(hasDistributeNode(nodes));
      }

      assertEqual(2000, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testInsertMainLevelWithReturn : function () {
      let c = db._create(cn, {numberOfShards:5});

      let expected = { writesExecuted: 2000, writesIgnored: 0 };
      let query = "FOR i IN 1..2000 INSERT { value: i } IN " + cn + " RETURN NEW";
      let actual = getModifyQueryResultsRaw(query);

      if (isCluster) {
        let nodes = AQL_EXPLAIN(query).plan.nodes;
        assertTrue(hasDistributeNode(nodes));
      }

      assertEqual(2000, c.count());
      assertEqual(2000, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testInsertInSubquery : function () {
      let c = db._create(cn, {numberOfShards:5});

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("RETURN (FOR i IN 1..100 INSERT { value: i } IN " + cn + ")");

      assertEqual(100, c.count());
      assertEqual(1, actual.json.length);
      assertEqual([ [ ] ], actual.json);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testInsertInSubqueryWithReturn : function () {
      let c = db._create(cn, {numberOfShards:5});

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("RETURN (FOR i IN 1..100 INSERT { value: i } IN " + cn + " RETURN NEW)");

      assertEqual(100, c.count());
      assertEqual(1, actual.json.length);
      assertEqual(100, actual.json[0].length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelWithKeySingle : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 1, writesIgnored: 0 };
      let query = "FOR d IN " + cn + " FILTER d._key == 'test93' REMOVE d IN " + cn;
      let actual = AQL_EXECUTE(query, {}, disableSingleDocOp);
      if (isCluster) {
        let plan = AQL_EXPLAIN(query, {}, disableSingleDocOp).plan;
        assertFalse(hasDistributeNode(plan.nodes));
        assertTrue(allNodesOfTypeAreRestrictedToShard(plan.nodes, 'RemoveNode', c));
        assertNotEqual(-1, plan.rules.indexOf("restrict-to-single-shard"));
      }

      assertEqual(99, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelWithKeySingleReturnOld : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 1, writesIgnored: 0 };
      let query = "FOR d IN " + cn + " FILTER d._key == 'test93' REMOVE d IN " + cn + " RETURN OLD";
      let actual = AQL_EXECUTE(query, {}, disableSingleDocOp);
      if (isCluster) {
        let plan = AQL_EXPLAIN(query,{}, disableSingleDocOp).plan;
        assertFalse(hasDistributeNode(plan.nodes));
        assertTrue(allNodesOfTypeAreRestrictedToShard(plan.nodes, 'RemoveNode', c));
        assertNotEqual(-1, plan.rules.indexOf("restrict-to-single-shard"));
      }

      assertEqual(99, c.count());
      assertEqual(1, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelWithoutKey : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let query = "FOR d IN " + cn + " REMOVE { foo: 'bar' } IN " + cn;

      assertQueryError(errors.ERROR_ARANGO_DOCUMENT_KEY_MISSING.code, query);
      if (isCluster) {
        let plan = AQL_EXPLAIN(query).plan;
        assertEqual(-1, plan.rules.indexOf("undistribute-remove-after-enum-coll"));
      }

      assertEqual(100, c.count());
    },

    testRemoveMainLevelSingleKey : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let query = "FOR d IN " + cn + " REMOVE { _key: 'bar' } IN " + cn;

      assertQueryError(errors.ERROR_ARANGO_DOCUMENT_NOT_FOUND.code, query);

      if (isCluster) {
        let plan = AQL_EXPLAIN(query).plan;
        assertEqual(-1, plan.rules.indexOf("undistribute-remove-after-enum-coll"));
      }

      assertEqual(100, c.count());
    },

    testRemoveMainLevelWithKey : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let query = "FOR d IN " + cn + " REMOVE { _key: d._key } IN " + cn;
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let plan = AQL_EXPLAIN(query).plan;
        assertFalse(hasDistributeNode(plan.nodes));
        assertNotEqual(-1, plan.rules.indexOf("undistribute-remove-after-enum-coll"));
      }

      assertEqual(0, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelWithKeyReturnOld : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let query = "FOR d IN " + cn + " REMOVE { _key: d._key } IN " + cn + " RETURN OLD";
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let plan = AQL_EXPLAIN(query).plan;
        assertFalse(hasDistributeNode(plan.nodes));
        assertNotEqual(-1, plan.rules.indexOf("undistribute-remove-after-enum-coll"));
      }

      assertEqual(0, c.count());
      assertEqual(100, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelWithKey2 : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let query = "FOR i IN 0..99 REMOVE { _key: CONCAT('test', i) } IN " + cn;
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let nodes = AQL_EXPLAIN(query).plan.nodes;
        assertTrue(hasDistributeNode(nodes));
      }

      assertEqual(0, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelWithKey2ReturnOld : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let query = "FOR i IN 0..99 REMOVE { _key: CONCAT('test', i) } IN " + cn + " RETURN OLD";
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let nodes = AQL_EXPLAIN(query).plan.nodes;
        assertTrue(hasDistributeNode(nodes));
      }

      assertEqual(0, c.count());
      assertEqual(100, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelDefaultShardKeyByReference : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let query = "FOR d IN " + cn + " REMOVE d IN " + cn;
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let plan = AQL_EXPLAIN(query).plan;
        assertFalse(hasDistributeNode(plan.nodes));
        assertNotEqual(-1, plan.rules.indexOf("undistribute-remove-after-enum-coll"));
      }

      assertEqual(0, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelDefaultShardKeyByAttribute : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let query = "FOR d IN " + cn + " REMOVE d._key IN " + cn;
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let plan = AQL_EXPLAIN(query).plan;
        assertFalse(hasDistributeNode(plan.nodes));
        assertNotEqual(-1, plan.rules.indexOf("undistribute-remove-after-enum-coll"));
      }

      assertEqual(0, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelDefaultShardKeyByObject : function () {
      let c = db._create(cn, {numberOfShards:5});

      { // no - RestrictToSingleShard
        for (let i = 0; i < 100; ++i) {
          c.insert({ id: i });
        }

        let expected = { writesExecuted: 100, writesIgnored: 0 };
        let query = "FOR d IN " + cn + " REMOVE { _key: d._key } IN " + cn;
        let actual = getModifyQueryResultsRaw(query, {}, disableRestrictToSingleShard);
        if (isCluster) {
          let plan = AQL_EXPLAIN(query, {}, disableRestrictToSingleShard).plan;
          assertFalse(hasDistributeNode(plan.nodes));
          assertNotEqual(-1, plan.rules.indexOf("undistribute-remove-after-enum-coll"));
        }

        assertEqual(0, c.count());
        assertEqual(0, actual.json.length);
        assertEqual(expected, sanitizeStats(actual.stats));
      }
      //  RestrictToSingleShard
      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let query = "FOR d IN " + cn + " REMOVE { _key: d._key } IN " + cn;
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let plan = AQL_EXPLAIN(query).plan;
        assertFalse(hasDistributeNode(plan.nodes));
        assertNotEqual(-1, plan.rules.indexOf("undistribute-remove-after-enum-coll"));
      }

      assertEqual(0, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelCustomShardKeyFixed : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: 42 });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let query = "FOR d IN " + cn + " REMOVE { _key: d._key, id: 42 } IN " + cn;
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let plan = AQL_EXPLAIN(query).plan;
        assertFalse(hasDistributeNode(plan.nodes));
        assertEqual(-1, plan.rules.indexOf("undistribute-remove-after-enum-coll"));
      }

      assertEqual(0, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelCustomShardKeyFixedSingle : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 1, writesIgnored: 99 };
      // this will only go to a single shard, as the shardkey is given in REMOVE!
      let query = `FOR d IN ${cn} REMOVE { _key: d._key, id: 42 } IN ${cn} OPTIONS { ignoreErrors: true }`;
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let plan = AQL_EXPLAIN(query).plan;
        assertFalse(hasDistributeNode(plan.nodes));
        assertEqual(-1, plan.rules.indexOf("undistribute-remove-after-enum-coll"));
        assertNotEqual(-1, plan.rules.indexOf("restrict-to-single-shard"));
      }

      assertEqual(99, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelCustomShardKeyFixedSingleWithFilter : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 1, writesIgnored: 0 };
      let query = "FOR d IN " + cn + " FILTER d.id == 42 REMOVE { _key: d._key, id: 42 } IN " + cn;
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let plan = AQL_EXPLAIN(query).plan;
        assertFalse(hasDistributeNode(plan.nodes));
        assertEqual(-1, plan.rules.indexOf("undistribute-remove-after-enum-coll"));
      }

      assertEqual(99, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelCustomShardKeys : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id1", "id2"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id1: i, id2: i % 10 });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let query = "FOR d IN " + cn + " REMOVE { _key: d._key, id1: d.id1, id2: d.id2 } IN " + cn;
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let plan = AQL_EXPLAIN(query).plan;
        assertFalse(hasDistributeNode(plan.nodes));
        assertNotEqual(-1, plan.rules.indexOf("undistribute-remove-after-enum-coll"));
      }

      assertEqual(0, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    // TODO This should now actually use the `restrict-to-single-shard` rule,
    // as it won't remove the non-matching documents in any case.
    // Until then, this will fail in cluster with writesIgnored being 490
    // instead of 90.
    testRemoveMainLevelCustomShardKeysFixed : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id1", "id2"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id1: i, id2: i % 10 });
      }

      let expected = { writesExecuted: 10, writesIgnored: 90 };

      let query = `FOR d IN ${cn}
                   REMOVE { _key: d._key, id1: d.id1, id2: 2 }
                   IN ${cn}
                   OPTIONS {ignoreErrors: true}`;
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let plan = AQL_EXPLAIN(query).plan;
        assertFalse(hasDistributeNode(plan.nodes));
        assertEqual(-1, plan.rules.indexOf("undistribute-remove-after-enum-coll"));
      }

      assertEqual(90, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelCustomShardKeysFixedWithFilter : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id1", "id2"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id1: i, id2: i % 10 });
      }

      let expected = { writesExecuted: 10, writesIgnored: isCluster ? 40 : 0 };
      let query = "FOR d IN " + cn + " FILTER d.id2 == 2 REMOVE { _key: d._key, id1: d.id1, id2: 2 } IN " + cn;
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let plan = AQL_EXPLAIN(query).plan;
        assertFalse(hasDistributeNode(plan.nodes));
        assertEqual(-1, plan.rules.indexOf("undistribute-remove-after-enum-coll"));
      }

      assertEqual(90, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelCustomShardKeysWithFilterIndexed : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id1", "id2"]});
      c.ensureIndex({ type: "hash", fields: ["id1", "id2"] });

      for (let i = 0; i < 100; ++i) {
        c.insert({ id1: i, id2: i % 10 });
      }

      let expected = { writesExecuted: 3, writesIgnored: 0 };
      let query = "FOR d IN " + cn + " FILTER d.id1 IN [ 2, 12, 22 ] && d.id2 == 2 REMOVE { _key: d._key, id1: d.id1, id2: d.id2 } IN " + cn;
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let plan = AQL_EXPLAIN(query).plan;
        assertFalse(hasDistributeNode(plan.nodes));
        assertNotEqual(-1, plan.rules.indexOf("undistribute-remove-after-enum-coll"));
      }

      assertEqual(97, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelCustomShardKeysMissing : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id1", "id2"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id1: i, id2: i % 10 });
      }

      let expected = { writesExecuted: 100, writesIgnored: isCluster ? 400 : 0 };
      let query = "FOR d IN " + cn + " REMOVE { _key: d._key, id1: d.id1 } IN " + cn;
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let plan = AQL_EXPLAIN(query).plan;
        assertFalse(hasDistributeNode(plan.nodes));
        assertEqual(-1, plan.rules.indexOf("undistribute-remove-after-enum-coll"));
        assertEqual(-1, plan.rules.indexOf("restrict-to-single-shard"));
      }

      assertEqual(0, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelCustomShardKey : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let query = "FOR d IN " + cn + " REMOVE { _key: d._key, id: d.id } IN " + cn;
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let plan = AQL_EXPLAIN(query).plan;
        assertFalse(hasDistributeNode(plan.nodes));
        assertNotEqual(-1, plan.rules.indexOf("undistribute-remove-after-enum-coll"));
      }

      assertEqual(0, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelCustomShardKey2 : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let query = "FOR d IN " + cn + " REMOVE d IN " + cn;
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let nodes = AQL_EXPLAIN(query).plan.nodes;
        assertFalse(hasDistributeNode(nodes));
      }

      assertEqual(0, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelCustomShardKeyReturnOld : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let query = "FOR d IN " + cn + " REMOVE { _key: d._key, id: d.id } IN " + cn + " RETURN OLD";
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let nodes = AQL_EXPLAIN(query).plan.nodes;
        assertFalse(hasDistributeNode(nodes));
      }

      assertEqual(0, c.count());
      assertEqual(100, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevel : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let query = "FOR d IN " + cn + " REMOVE d IN " + cn;
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let nodes = AQL_EXPLAIN(query).plan.nodes;
        assertFalse(hasDistributeNode(nodes));
      }

      assertEqual(0, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveMainLevelWithReturn : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let query = "FOR d IN " + cn + " REMOVE d IN " + cn + " RETURN OLD";
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let nodes = AQL_EXPLAIN(query).plan.nodes;
        assertFalse(hasDistributeNode(nodes));
      }

      assertEqual(0, c.count());
      assertEqual(100, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveInSubquery : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("RETURN (FOR d IN " + cn + " REMOVE d IN " + cn + ")");

      assertEqual(0, c.count());
      assertEqual(1, actual.json.length);
      assertEqual([ [ ] ], actual.json);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveInSubqueryWithReturn : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("RETURN (FOR d IN " + cn + " REMOVE d IN " + cn + " RETURN OLD)");

      assertEqual(0, c.count());
      assertEqual(1, actual.json.length);
      assertEqual(100, actual.json[0].length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testUpdateMainLevel : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let query = "FOR d IN " + cn + " UPDATE d WITH { value: 2 } IN " + cn;
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let nodes = AQL_EXPLAIN(query).plan.nodes;
        assertTrue(hasDistributeNode(nodes));
      }

      assertEqual(100, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testUpdateMainLevelWithReturnOld : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let query = "FOR d IN " + cn + " UPDATE d WITH { value: 2 } IN " + cn + " RETURN OLD";
      let actual = getModifyQueryResultsRaw(query);
      if (isCluster) {
        let nodes = AQL_EXPLAIN(query).plan.nodes;
        assertTrue(hasDistributeNode(nodes));
      }

      assertEqual(100, c.count());
      assertEqual(100, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testUpdateMainLevelWithReturnNew : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("FOR d IN " + cn + " UPDATE d WITH { value: 2 } IN " + cn + " RETURN NEW");

      assertEqual(100, c.count());
      assertEqual(100, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testUpdateInSubquery : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("RETURN (FOR d IN " + cn + " UPDATE d WITH { value: 2 } IN " + cn + ")");

      assertEqual(100, c.count());
      assertEqual(1, actual.json.length);
      assertEqual([ [ ] ], actual.json);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testUpdateInSubqueryWithReturnOld : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("RETURN (FOR d IN " + cn + " UPDATE d WITH { value: 2 } IN " + cn + " RETURN OLD)");

      assertEqual(100, c.count());
      assertEqual(1, actual.json.length);
      assertEqual(100, actual.json[0].length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testUpdateInSubqueryWithReturnNew : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("RETURN (FOR d IN " + cn + " UPDATE d WITH { value: 2 } IN " + cn + " RETURN NEW)");

      assertEqual(100, c.count());
      assertEqual(1, actual.json.length);
      assertEqual(100, actual.json[0].length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testReplaceMainLevel : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("FOR d IN " + cn + " REPLACE d WITH { value: 2 } IN " + cn);

      assertEqual(100, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testReplaceMainLevelWithReturnOld : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("FOR d IN " + cn + " REPLACE d WITH { value: 2 } IN " + cn + " RETURN OLD");

      assertEqual(100, c.count());
      assertEqual(100, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testReplaceMainLevelWithReturnNew : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("FOR d IN " + cn + " REPLACE d WITH { value: 2 } IN " + cn + " RETURN NEW");

      assertEqual(100, c.count());
      assertEqual(100, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testReplaceInSubquery : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("RETURN (FOR d IN " + cn + " REPLACE d WITH { value: 2 } IN " + cn + ")");

      assertEqual(100, c.count());
      assertEqual(1, actual.json.length);
      assertEqual([ [ ] ], actual.json);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testReplaceInSubqueryWithReturnOld : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("RETURN (FOR d IN " + cn + " REPLACE d WITH { value: 2 } IN " + cn + " RETURN OLD)");

      assertEqual(100, c.count());
      assertEqual(1, actual.json.length);
      assertEqual(100, actual.json[0].length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testReplaceInSubqueryWithReturnNew : function () {
      let c = db._create(cn, {numberOfShards:5});

      for (let i = 0; i < 100; ++i) {
        c.insert({ _key: "test" + i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("RETURN (FOR d IN " + cn + " REPLACE d WITH { value: 2 } IN " + cn + " RETURN NEW)");

      assertEqual(100, c.count());
      assertEqual(1, actual.json.length);
      assertEqual(100, actual.json[0].length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    // use custom shard key

    testInsertMainLevelCustomShardKeyWithReturn : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("FOR i IN 1..100 INSERT { id: i, value: i } IN " + cn + " RETURN NEW");

      assertEqual(100, c.count());
      assertEqual(100, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testInsertCustomShardKeyInSubquery : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("RETURN (FOR i IN 1..100 INSERT { id: i, value: i } IN " + cn + ")");

      assertEqual(100, c.count());
      assertEqual(1, actual.json.length);
      assertEqual([ [ ] ], actual.json);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testInsertCustomShardKeyInSubqueryWithReturn : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("RETURN (FOR i IN 1..100 INSERT { id: i, value: i } IN " + cn + " RETURN NEW)");

      assertEqual(100, c.count());
      assertEqual(1, actual.json.length);
      assertEqual(100, actual.json[0].length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveCustomShardKeyMainLevel : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("FOR d IN " + cn + " REMOVE d IN " + cn);

      assertEqual(0, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveCustomShardKeyMainLevelWithReturn : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("FOR d IN " + cn + " REMOVE d IN " + cn + " RETURN OLD");

      assertEqual(0, c.count());
      assertEqual(100, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveCustomShardKeyInSubquery : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      { // no - RestrictToSingleShard
        for (let i = 0; i < 100; ++i) {
          c.insert({ id: i });
        }

        let expected = { writesExecuted: 100, writesIgnored: 0 };
        let actual = getModifyQueryResultsRaw("RETURN (FOR d IN " + cn + " REMOVE d IN " + cn + ")", {}, disableRestrictToSingleShard);

        assertEqual(0, c.count());
        assertEqual(1, actual.json.length);
        assertEqual([ [ ] ], actual.json);
        assertEqual(expected, sanitizeStats(actual.stats));
      }

      { // RestrictToSingleShard
        for (let i = 0; i < 100; ++i) {
          c.insert({ id: i });
        }

        let expected = { writesExecuted: 100, writesIgnored: 0 };
        let actual = getModifyQueryResultsRaw("RETURN (FOR d IN " + cn + " REMOVE d IN " + cn + ")");

        assertEqual(0, c.count());
        assertEqual(1, actual.json.length);
        assertEqual([ [ ] ], actual.json);
        assertEqual(expected, sanitizeStats(actual.stats));
      }
    },

    testRemoveCustomShardKeyInSubqueryWithReturn : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("RETURN (FOR d IN " + cn + " REMOVE d IN " + cn + " RETURN OLD)");

      assertEqual(0, c.count());
      assertEqual(1, actual.json.length);
      assertEqual(100, actual.json[0].length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testUpdateCustomShardKeyMainLevel : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: isCluster ? 400 : 0 };
      let actual = getModifyQueryResultsRaw("FOR d IN " + cn + " UPDATE d WITH { value: 2 } IN " + cn);

      assertEqual(100, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testUpdateCustomShardKeyMainLevelWithReturnOld : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: isCluster ? 400 : 0 };
      let actual = getModifyQueryResultsRaw("FOR d IN " + cn + " UPDATE d WITH { value: 2 } IN " + cn + " RETURN OLD");

      assertEqual(100, c.count());
      assertEqual(100, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testUpdateCustomShardKeyMainLevelWithReturnNew : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: isCluster ? 400 : 0 };
      let actual = getModifyQueryResultsRaw("FOR d IN " + cn + " UPDATE d WITH { value: 2 } IN " + cn + " RETURN NEW");

      assertEqual(100, c.count());
      assertEqual(100, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testUpdateCustomShardKeyInSubquery : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: isCluster ? 400 : 0 };
      let actual = getModifyQueryResultsRaw("RETURN (FOR d IN " + cn + " UPDATE d WITH { value: 2 } IN " + cn + ")");

      assertEqual(100, c.count());
      assertEqual(1, actual.json.length);
      assertEqual([ [ ] ], actual.json);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testUpdateCustomShardKeyInSubqueryWithReturnOld : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: isCluster ? 400 : 0 };
      let actual = getModifyQueryResultsRaw("RETURN (FOR d IN " + cn + " UPDATE d WITH { value: 2 } IN " + cn + " RETURN OLD)");

      assertEqual(100, c.count());
      assertEqual(1, actual.json.length);
      assertEqual(100, actual.json[0].length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testUpdateCustomShardKeyInSubqueryWithReturnNew : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: isCluster ? 400 : 0 };
      let actual = getModifyQueryResultsRaw("RETURN (FOR d IN " + cn + " UPDATE d WITH { value: 2 } IN " + cn + " RETURN NEW)");

      assertEqual(100, c.count());
      assertEqual(1, actual.json.length);
      assertEqual(100, actual.json[0].length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testReplaceCustomShardKeyMainLevel : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("FOR d IN " + cn + " REPLACE d WITH { id: d.id, value: 2 } IN " + cn);

      assertEqual(100, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testReplaceCustomShardKeyMainLevelWithReturnOld : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("FOR d IN " + cn + " REPLACE d WITH { id: d.id, value: 2 } IN " + cn + " RETURN OLD");

      assertEqual(100, c.count());
      assertEqual(100, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testReplaceCustomShardKeyMainLevelWithReturnNew : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("FOR d IN " + cn + " REPLACE d WITH { id: d.id, value: 2 } IN " + cn + " RETURN NEW");

      assertEqual(100, c.count());
      assertEqual(100, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testReplaceCustomShardKeyInSubquery : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("RETURN (FOR d IN " + cn + " REPLACE d WITH { id: d.id, value: 2 } IN " + cn + ")");

      assertEqual(100, c.count());
      assertEqual(1, actual.json.length);
      assertEqual([ [ ] ], actual.json);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testReplaceCustomShardKeyInSubqueryWithReturnOld : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("RETURN (FOR d IN " + cn + " REPLACE d WITH { id: d.id, value: 2 } IN " + cn + " RETURN OLD)");

      assertEqual(100, c.count());
      assertEqual(1, actual.json.length);
      assertEqual(100, actual.json[0].length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testReplaceCustomShardKeyInSubqueryWithReturnNew : function () {
      let c = db._create(cn, {numberOfShards:5, shardKeys: ["id"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ id: i });
      }

      let expected = { writesExecuted: 100, writesIgnored: 0 };
      let actual = getModifyQueryResultsRaw("RETURN (FOR d IN " + cn + " REPLACE d WITH { id: d.id, value: 2 } IN " + cn + " RETURN NEW)");

      assertEqual(100, c.count());
      assertEqual(1, actual.json.length);
      assertEqual(100, actual.json[0].length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveObjectWithNonShardedNonMatchingPattern : function () {
      // tests that the keyExpression is used as a pattern for the document,
      // i.e., not only the _key must match but other attributes as well.

      const c = db._create(cn);

      for (let i = 0; i < 99; ++i) {
        c.insert({ someAttr: "1" });
      }
      c.insert({ someAttr: "42" });

      const query = `
        FOR d IN ${cn}
          REMOVE { _key: d._key, someAttr: '1' }
            IN ${cn}
      `;
      try {
        db._query(query);
        fail();
      } catch (err) {
        assertEqual(err.errorNum, errors.ERROR_ARANGO_DOCUMENT_NOT_FOUND.code);
      }

      // all but one document could be removed
      if (isCluster) {
        // without transactional guarantees, at least the non-matching document
        // may not have been removed
        assertEqual(1, c.toArray().filter(x => x.someAttr === '42').length);
      } else {
        // transaction should fail on single server
        assertEqual(100, c.count());
      }
    },

    testRemoveObjectWithNonShardedNonMatchingPatternIgnore : function () {
      // tests that the keyExpression is used as a pattern for the document,
      // i.e., not only the _key must match but other attributes as well.

      const c = db._create(cn);

      for (let i = 0; i < 100; ++i) {
        c.insert({ someAttr: "" + i });
      }

      const expected = { writesExecuted: 1, writesIgnored: 99 };
      const query = `
        FOR d IN ${cn}
          REMOVE { _key: d._key, someAttr: '42' }
            IN ${cn}
            OPTIONS { ignoreErrors: true }
      `;
      const actual = getModifyQueryResultsRaw(query);

      assertEqual(99, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testReplaceObjectWithNonShardedNonMatchingPattern : function () {
      // tests that the keyExpression is used as a pattern for the document,
      // i.e., not only the _key must match but other attributes as well.

      const c = db._create(cn);

      for (let i = 0; i < 99; ++i) {
        c.insert({ someAttr: "1" });
      }
      c.insert({ someAttr: "42" });

      const query = `
        FOR d IN ${cn}
          REPLACE { _key: d._key, someAttr: '1' }
            WITH { replaced: true }
            IN ${cn}
      `;


      try {
        db._query(query);
        fail();
      } catch (err) {
        assertEqual(err.errorNum, errors.ERROR_ARANGO_DOCUMENT_NOT_FOUND.code);
      }

      // all but one document could be replaced
      if (isCluster) {
        // without transactional guarantees, at least the non-matching document
        // may not have been replaced
        assertEqual(
          1,
          c.toArray().filter(x => x.someAttr === '42' && !x.replaced).length
        );
      } else {
        // transaction should fail on single server
        assertEqual(100, c.toArray().filter(x => !x.replaced).length);
      }
    },

    testReplaceObjectWithNonShardedNonMatchingPatternIgnore : function () {
      // tests that the keyExpression is used as a pattern for the document,
      // i.e., not only the _key must match but other attributes as well.

      const c = db._create(cn);

      for (let i = 0; i < 100; ++i) {
        c.insert({ someAttr: "" + i });
      }

      const expected = { writesExecuted: 1, writesIgnored: 99 };
      const query = `
        FOR d IN ${cn}
          REPLACE { _key: d._key, someAttr: '42' }
            WITH { someAttr: '-42' }
            IN ${cn}
            OPTIONS { ignoreErrors: true }
      `;
      const actual = getModifyQueryResultsRaw(query);

      const docs = c.all().toArray();
      assertEqual(
        [..._.range(0, 42), -42, ..._.range(43, 100)].map(String).sort(),
        docs.map(d => d.someAttr).sort()
      );

      assertEqual(100, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testSimpleReplaceObjectWithNonShardedNonMatchingPattern : function () {
      // tests that the document is not used as a pattern, i.e., only the _key
      // may be used to select the document, while the other attributes will be
      // used exclusively for the replace.

      const c = db._create(cn);

      for (let i = 0; i < 100; ++i) {
        c.insert({ someAttr: "" + i });
      }

      const expected = { writesExecuted: 100, writesIgnored: 0 };
      const query = `
        FOR d IN ${cn}
          REPLACE { _key: d._key, someAttr: '42' }
            IN ${cn}
      `;
      const actual = getModifyQueryResultsRaw(query);

      const docs = c.all().toArray();
      assertEqual(
        Array(100).fill('42', 0, 100),
        docs.map(d => d.someAttr)
      );

      assertEqual(100, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testUpdateObjectWithNonShardedNonMatchingPattern : function () {
      // tests that the keyExpression is used as a pattern for the document,
      // i.e., not only the _key must match but other attributes as well.

      const c = db._create(cn);

      for (let i = 0; i < 99; ++i) {
        c.insert({ someAttr: "1" });
      }
      c.insert({ someAttr: "42" });

      const query = `
        FOR d IN ${cn}
          REPLACE { _key: d._key, someAttr: '1' }
            WITH { updated: true }
            IN ${cn}
      `;


      try {
        db._query(query);
        fail();
      } catch (err) {
        assertEqual(err.errorNum, errors.ERROR_ARANGO_DOCUMENT_NOT_FOUND.code);
      }

      // all but one document could be updated
      if (isCluster) {
        // without transactional guarantees, at least the non-matching document
        // may not have been updated
        assertEqual(
          1,
          c.toArray().filter(x => x.someAttr === '42' && !x.updated).length
        );
      } else {
        // transaction should fail on single server
        assertEqual(100, c.toArray().filter(x => !x.updated).length);
      }
    },

    testUpdateObjectWithNonShardedNonMatchingPatternIgnore : function () {
      // tests that the keyExpression is used as a pattern for the document,
      // i.e., not only the _key must match but other attributes as well.

      const c = db._create(cn);

      for (let i = 0; i < 100; ++i) {
        c.insert({ someAttr: "" + i });
      }

      const expected = { writesExecuted: 1, writesIgnored: 99 };
      const query = `
        FOR d IN ${cn}
          UPDATE { _key: d._key, someAttr: '42' }
            WITH { someAttr: '-42' }
            IN ${cn}
            OPTIONS { ignoreErrors: true }
      `;
      const actual = getModifyQueryResultsRaw(query);

      const docs = c.all().toArray();
      assertEqual(
        [..._.range(0, 42), -42, ..._.range(43, 100)].map(String).sort(),
        docs.map(d => d.someAttr).sort()
      );

      assertEqual(100, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testSimpleUpdateObjectWithNonShardedNonMatchingPattern : function () {
      // tests that the document is not used as a pattern, i.e., only the _key
      // may be used to select the document, while the other attributes will be
      // used exclusively for the update.

      const c = db._create(cn);

      for (let i = 0; i < 100; ++i) {
        c.insert({ someAttr: "" + i });
      }

      const expected = { writesExecuted: 100, writesIgnored: 0 };
      const query = `
        FOR d IN ${cn}
          UPDATE { _key: d._key, someAttr: '42' }
            IN ${cn}
      `;
      const actual = getModifyQueryResultsRaw(query);

      const docs = c.all().toArray();
      assertEqual(
        Array(100).fill('42', 0, 100),
        docs.map(d => d.someAttr)
      );

      assertEqual(100, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testRemoveObjectWithShardedNonMatchingPattern : function () {
      // tests that the keyExpression is used as a pattern for the document,
      // i.e., not only the _key must match but other attributes as well.

      const c = db._create(cn, {numberOfShards:5, shardKeys: ["someAttr"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ someAttr: "" + i % 10 });
      }

      const expected = { writesExecuted: 10, writesIgnored: 90 };
      const query = `
        FOR d IN ${cn}
          REMOVE { _key: d._key, someAttr: '5' }
            IN ${cn}
            OPTIONS { ignoreErrors: true }
      `;
      const actual = getModifyQueryResultsRaw(query);

      assertEqual(90, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    // TODO This tests fails with
    // "testReplaceObjectWithShardedNonMatchingPattern" failed:
    // ArangoError 4: AQL: Error message received from shard '' on cluster node 'PRMR-9d6d140a-2a66-45a5-9a5b-d8b170566d91':
    // Error message received from shard '' on cluster node 'CRDN-63b74823-42cc-40a2-ad24-c3f737b100c8':
    // AQL: unknown shard id s2022999
    // (exception location: /home/tobias/Documents/ArangoDB/arangodb/arangodb/arangod/Aql/ClusterBlocks.cpp:328).
    // Please report this error to arangodb.com
    // (exception location: /home/tobias/Documents/ArangoDB/arangodb/arangodb/arangod/Aql/ClusterBlocks.cpp:1144).
    // Please report this error to arangodb.com
    // (exception location: /home/tobias/Documents/ArangoDB/arangodb/arangodb/arangod/Aql/ClusterBlocks.cpp:1144).
    // Please report this error to arangodb.com
    // (while executing)
    // - ArangoError: AQL: Error message received from shard '' on cluster node 'PRMR-9d6d140a-2a66-45a5-9a5b-d8b170566d91':
    // Error message received fromshard '' on cluster node 'CRDN-63b74823-42cc-40a2-ad24-c3f737b100c8':
    // AQL: unknown shard id s2022999
    // (exception location: /home/tobias/Documents/ArangoDB/arangodb/arangodb/arangod/Aql/ClusterBlocks.cpp:328).
    // Please report this error to arangodb.com
    // (exception location: /home/tobias/Documents/ArangoDB/arangodb/arangodb/arangod/Aql/ClusterBlocks.cpp:1144).
    // Please report this error to arangodb.com
    // (exception location: /home/tobias/Documents/ArangoDB/arangodb/arangodb/arangod/Aql/ClusterBlocks.cpp:1144).
    // Please report this error to arangodb.com
    // (while executing)
    testReplaceObjectWithShardedNonMatchingPattern : function () {
      // tests that the keyExpression is used as a pattern for the document,
      // i.e., not only the _key must match but other attributes as well.

      const c = db._create(cn, {numberOfShards:5, shardKeys: ["someAttr"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ someAttr: "" + i % 10 });
      }

      const expected = { writesExecuted: 10, writesIgnored: 90 };
      const query = `
        FOR d IN ${cn}
          REPLACE { _key: d._key, someAttr: '5' }
            WITH { someAttr: '-42' }
            IN ${cn}
            OPTIONS { ignoreErrors: true }
      `;
      const actual = getModifyQueryResultsRaw(query);


      const docs = c.all().toArray();
      assertEqual(
        [..._.range(0, 100).map(d => d % 10).filter(d => d != 5),
          ...Array(10).fill(-42)].map(String).sort(),
        docs.map(d => d.someAttr).sort()
      );

      assertEqual(100, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    // TODO This test fails (in cluster mode) with
    // "must not change the value of a shard key attribute"
    // An error should be expected here, but it may also be a document not found.
    // In fact, always failing with document not found is more desirable.
    // Also, this should maybe only be tested in cluster mode.
    /*
    testSimpleReplaceObjectWithShardedNonMatchingPattern : function () {
      // tests that the document is not used as a pattern, i.e., only the _key
      // may be used to select the document, while the other attributes will be
      // used exclusively for the replace.

      const c = db._create(cn, {numberOfShards:5, shardKeys: ["someAttr"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ someAttr: "" + i % 10 });
      }

      const expected = { writesExecuted: 100, writesIgnored: 0 };
      const query = `
        FOR d IN ${cn}
          REPLACE { _key: d._key, someAttr: '42' }
            IN ${cn}
      `;
      const actual = getModifyQueryResultsRaw(query);

      const docs = c.all().toArray();
      assertEqual(
        Array(100).fill('42', 0, 100),
        docs.map(d => d.someAttr)
      );

      assertEqual(100, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },
    */

    testUpdateObjectWithShardedNonMatchingPattern : function () {
      // tests that the keyExpression is used as a pattern for the document,
      // i.e., not only the _key must match but other attributes as well.

      const c = db._create(cn, {numberOfShards:5, shardKeys: ["someAttr"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ someAttr: "" + i % 10 });
      }

      const expected = { writesExecuted: 10, writesIgnored: 90 };
      const query = `
        FOR d IN ${cn}
          UPDATE { _key: d._key, someAttr: '5' }
            WITH { value: 'updated' }
            IN ${cn}
            OPTIONS { ignoreErrors: true }
      `;
      const actual = getModifyQueryResultsRaw(query);

      const docs = c.all().toArray();
      const matchingDocs = docs.filter(x => x.someAttr % 10 === 5);
      const nonMatchingDocs = docs.filter(x => x.someAttr % 10 !== 5);
      assertEqual(10, matchingDocs.length);
      assertEqual(90, nonMatchingDocs.length);
      assertTrue(_.every(matchingDocs.map(x => x.value === 'updated')));
      assertTrue(_.every(nonMatchingDocs.map(x => !x.hasOwnProperty('value'))));

      assertEqual(100, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    // TODO this fails (and must fail), either with document not found
    // or must not change shard key. It should only fail with document not found
    // in the future.
    /*
    testSimpleUpdateObjectWithShardedNonMatchingPattern : function () {
      // tests that the document is not used as a pattern, i.e., only the _key
      // may be used to select the document, while the other attributes will be
      // used exclusively for the update.

      const c = db._create(cn, {numberOfShards:5, shardKeys: ["someAttr"]});

      for (let i = 0; i < 100; ++i) {
        c.insert({ someAttr: "" + i % 10 });
      }

      const expected = { writesExecuted: 100, writesIgnored: 0 };
      const query = `
        FOR d IN ${cn}
          UPDATE { _key: d._key, someAttr: '42' }
            IN ${cn}
      `;
      const actual = getModifyQueryResultsRaw(query);

      const docs = c.all().toArray();
      assertEqual(
        Array(100).fill('42', 0, 100),
        docs.map(d => d.someAttr)
      );

      assertEqual(100, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },
    */

    testRemoveObjectWithNonShardedNonMatchingPatternNoIgnoreRev : function () {
      // tests that the keyExpression is used as a pattern for the document,
      // i.e., not only the _key must match but other attributes as well.
      // _rev should not be ignored if `ignoreRevs == false`.

      const c = db._create(cn);

      for (let i = 0; i < 100; ++i) {
        c.insert({ someAttr: "" + i % 10 });
      }

      const expected = { writesExecuted: 0, writesIgnored: 100 };
      const query = `
        FOR d IN ${cn}
          REMOVE { _key: d._key, someAttr: '5', _rev: "ignored?" }
            IN ${cn}
            OPTIONS { ignoreErrors: true, ignoreRevs: false }
      `;
      const actual = getModifyQueryResultsRaw(query);

      assertEqual(100, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testReplaceObjectWithNonShardedNonMatchingPatternNoIgnoreRev : function () {
      // tests that the keyExpression is used as a pattern for the document,
      // i.e., not only the _key must match but other attributes as well.
      // _rev should not be ignored if `ignoreRevs == false`.

      const c = db._create(cn);

      for (let i = 0; i < 100; ++i) {
        c.insert({ someAttr: "" + i % 10 });
      }

      const expected = { writesExecuted: 0, writesIgnored: 100 };
      const query = `
        FOR d IN ${cn}
          REPLACE { _key: d._key, someAttr: '5', _rev: "ignored?" }
            WITH { someAttr: '-42' }
            IN ${cn}
            OPTIONS { ignoreErrors: true, ignoreRevs: false }
      `;
      const actual = getModifyQueryResultsRaw(query);



      const docs = c.all().toArray();
      assertEqual(
        _.range(0, 100).map(d => String(d % 10)).sort(),
        docs.map(d => d.someAttr).sort()
      );

      assertEqual(100, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    testUpdateObjectWithNonShardedNonMatchingPatternNoIgnoreRev : function () {
      // tests that the keyExpression is used as a pattern for the document,
      // i.e., not only the _key must match but other attributes as well.
      // _rev should not be ignored if `ignoreRevs == false`.

      const c = db._create(cn);

      for (let i = 0; i < 100; ++i) {
        c.insert({ someAttr: "" + i % 10 });
      }

      const expected = { writesExecuted: 0, writesIgnored: 100 };
      const query = `
        FOR d IN ${cn}
          UPDATE { _key: d._key, someAttr: '5', _rev: "ignored?" }
            WITH { someAttr: '-42' }
            IN ${cn}
            OPTIONS { ignoreErrors: true, ignoreRevs: false }
      `;
      const actual = getModifyQueryResultsRaw(query);

      const docs = c.all().toArray();
      assertEqual(
        _.range(0, 100).map(d => String(d % 10)).sort(),
        docs.map(d => d.someAttr).sort()
      );

      assertEqual(100, c.count());
      assertEqual(0, actual.json.length);
      assertEqual(expected, sanitizeStats(actual.stats));
    },

    // TODO make sure this is tested in all combinations, i.e.:
    // op: update/replace/remove/upsert
    // op-variants if applicable
    // cluster / single server
    // enterprise / community
    // mmfiles / rocksdb
    // shard keys / unsharded keys
    // with/without optimization
    // with/without ignoreErrors

  };
}

jsunity.run(ahuacatlModifySuite);

return jsunity.done();
