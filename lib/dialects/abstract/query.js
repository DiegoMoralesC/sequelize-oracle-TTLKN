'use strict';

var Utils = require('../../utils'),
  Dot = require('dottie'),
  QueryTypes = require('../../query-types');

var AbstractQuery = function (database, sequelize, options) {};

/**
  The function takes the result of the query execution and groups
  the associated data by the callee.

  Example:
    groupJoinData([
      {
        some: 'data',
        id: 1,
        association: { foo: 'bar', id: 1 }
      }, {
        some: 'data',
        id: 1,
        association: { foo: 'bar', id: 2 }
      }, {
        some: 'data',
        id: 1,
        association: { foo: 'bar', id: 3 }
      }
    ])

  Result:
    Something like this:

    [
      {
        some: 'data',
        id: 1,
        association: [
          { foo: 'bar', id: 1 },
          { foo: 'bar', id: 2 },
          { foo: 'bar', id: 3 }
        ]
      }
    ]
*/
/*
 * Assumptions
 * ID is not necessarily the first field
 * All fields for a level is grouped in the same set (i.e. Panel.id, Task.id, Panel.title is not possible)
 * Parent keys will be seen before any include/child keys
 * Previous set won't necessarily be parent set (one parent could have two children, one child would then be previous set for the other)
 */

/*
 * Author (MH) comment: This code is an unreadable mess, but its performant.
 * groupJoinData is a performance critical function so we prioritize perf over readability.
 */

var groupJoinData = function (rows, includeOptions, options) {
  if (!rows.length) {
    return [];
  }

  var
    // Generic looping
    i, length, $i, $length
    // Row specific looping
    , rowsI, rowsLength = rows.length,
    row
    // Key specific looping
    , keys, key, keyI, keyLength, prevKey, values, topValues, topExists, checkExisting = options.checkExisting
    // If we don't have to deduplicate we can pre-allocate the resulting array
    ,
    results = checkExisting ? [] : new Array(rowsLength),
    resultMap = {},
    includeMap = {},
    itemHash, parentHash, topHash
    // Result variables for the respective functions
    , $keyPrefix, $keyPrefixString, $prevKeyPrefixString, $prevKeyPrefix, $lastKeyPrefix, $current, $parent
    // Map each key to an include option
    , previousPiece, buildIncludeMap = function (piece) {
      if ($current.includeMap[piece]) {
        includeMap[key] = $current = $current.includeMap[piece];
        if (previousPiece) {
          previousPiece = previousPiece + '.' + piece;
        } else {
          previousPiece = piece;
        }
        includeMap[previousPiece] = $current;
      }
    }
    // Calcuate the last item in the array prefix ('Results' for 'User.Results.id')
    ,
    lastKeyPrefixMemo = {},
    lastKeyPrefix = function (key) {
      if (!lastKeyPrefixMemo[key]) {
        var prefix = keyPrefix(key),
          length = prefix.length;

        lastKeyPrefixMemo[key] = !length ? '' : prefix[length - 1];
      }
      return lastKeyPrefixMemo[key];
    }
    // Calculate the string prefix of a key ('User.Results' for 'User.Results.id')
    ,
    keyPrefixStringMemo = {},
    keyPrefixString = function (key, memo) {
      if (!memo[key]) {
        memo[key] = key.substr(0, key.lastIndexOf('.'));
      }
      return memo[key];
    }
    // Removes the prefix from a key ('id' for 'User.Results.id')
    ,
    removeKeyPrefixMemo = {},
    removeKeyPrefix = function (key) {
      if (!removeKeyPrefixMemo[key]) {
        var index = key.lastIndexOf('.');
        removeKeyPrefixMemo[key] = key.substr(index === -1 ? 0 : index + 1);
      }
      return removeKeyPrefixMemo[key];
    }
    // Calculates the array prefix of a key (['User', 'Results'] for 'User.Results.id')
    ,
    keyPrefixMemo = {},
    keyPrefix = function (key) {
      // We use a double memo and keyPrefixString so that different keys with the same prefix will receive the same array instead of differnet arrays with equal values
      if (!keyPrefixMemo[key]) {
        var prefixString = keyPrefixString(key, keyPrefixStringMemo);
        if (!keyPrefixMemo[prefixString]) {
          keyPrefixMemo[prefixString] = prefixString ? prefixString.split('.') : [];
        }
        keyPrefixMemo[key] = keyPrefixMemo[prefixString];
      }
      return keyPrefixMemo[key];
    },
    primaryKeyAttributes, prefix;

  for (rowsI = 0; rowsI < rowsLength; rowsI++) {
    row = rows[rowsI];

    // Keys are the same for all rows, so only need to compute them on the first row
    if (rowsI === 0) {
      keys = Object.keys(row);
      keyLength = keys.length;
    }

    if (checkExisting) {
      topExists = false;

      // Compute top level hash key (this is usually just the primary key values)
      $length = includeOptions.model.primaryKeyAttributes.length;
      if ($length === 1) {
        topHash = row[includeOptions.model.primaryKeyAttributes[0]];
      } else {
        topHash = '';
        for ($i = 0; $i < $length; $i++) {
          topHash += row[includeOptions.model.primaryKeyAttributes[$i]];
        }
      }
    }

    topValues = values = {};
    $prevKeyPrefix = undefined;
    for (keyI = 0; keyI < keyLength; keyI++) {
      key = keys[keyI];

      // The string prefix isn't actualy needed
      // We use it so keyPrefix for different keys will resolve to the same array if they have the same prefix
      // TODO: Find a better way?
      $keyPrefixString = keyPrefixString(key, keyPrefixStringMemo);
      $keyPrefix = keyPrefix(key);

      // On the first row we compute the includeMap
      if (rowsI === 0 && includeMap[key] === undefined) {
        if (!$keyPrefix.length) {
          includeMap[key] = includeMap[''] = includeOptions;
        } else {
          $current = includeOptions;
          previousPiece = undefined;
          $keyPrefix.forEach(buildIncludeMap);
        }
      }

      // End of key set
      if ($prevKeyPrefix !== undefined && $prevKeyPrefix !== $keyPrefix) {
        if (checkExisting) {
          // Compute hash key for this set instance
          // TODO: Optimize
          length = $prevKeyPrefix.length;
          $parent = null;
          parentHash = null;

          if (length) {
            for (i = 0; i < length; i++) {
              prefix = $parent ? $parent + '.' + $prevKeyPrefix[i] : $prevKeyPrefix[i];
              primaryKeyAttributes = includeMap[prefix].model.primaryKeyAttributes;
              $length = primaryKeyAttributes.length;
              if ($length === 1) {
                itemHash = prefix + row[prefix + '.' + primaryKeyAttributes[0]];
              } else {
                itemHash = prefix;
                for ($i = 0; $i < $length; $i++) {
                  itemHash += row[prefix + '.' + primaryKeyAttributes[$i]];
                }
              }
              if (!parentHash) {
                parentHash = topHash;
              }

              itemHash = parentHash + itemHash;
              $parent = prefix;
              if (i < length - 1) {
                parentHash = itemHash;
              }
            }
          } else {
            itemHash = topHash;
          }

          if (itemHash === topHash) {
            if (!resultMap[itemHash]) {
              resultMap[itemHash] = values;
            } else {
              topExists = true;
            }
          } else {
            if (!resultMap[itemHash]) {
              $parent = resultMap[parentHash];
              $lastKeyPrefix = lastKeyPrefix(prevKey);

              if (includeMap[prevKey].association.isSingleAssociation) {
                $parent[$lastKeyPrefix] = resultMap[itemHash] = values;
              } else {
                if (!$parent[$lastKeyPrefix]) {
                  $parent[$lastKeyPrefix] = [];
                }
                $parent[$lastKeyPrefix].push(resultMap[itemHash] = values);
              }
            }
          }

          // Reset values
          values = {};
        } else {
          // If checkExisting is false it's because there's only 1:1 associations in this query
          // However we still need to map onto the appropriate parent
          // For 1:1 we map forward, initializing the value object on the parent to be filled in the next iterations of the loop
          $current = topValues;
          length = $keyPrefix.length;
          if (length) {
            for (i = 0; i < length; i++) {
              if (i === length - 1) {
                values = $current[$keyPrefix[i]] = {};
              }
              $current = $current[$keyPrefix[i]];
            }
          }
        }
      }

      // get clob
      if (row[key] && row[key].constructor.name === 'Lob') {
        let isLoaded = false;
        let lobData = '';
        let lob = row[key];

        if (lob) {
          lob.setEncoding('utf8');

          lob.on('data', function (chunk) {
            lobData += chunk;
          });

          lob.on('end', function () {
            isLoaded = true;
            row[key] = lobData;
          });

          while (!isLoaded) {
            require('deasync').sleep(5);
          }
        }
      }

      // End of iteration, set value and set prev values (for next iteration)
      values[removeKeyPrefix(key)] = row[key];
      prevKey = key;
      $prevKeyPrefix = $keyPrefix;
      $prevKeyPrefixString = $keyPrefixString;
    }

    if (checkExisting) {
      length = $prevKeyPrefix.length;
      $parent = null;
      parentHash = null;

      if (length) {
        for (i = 0; i < length; i++) {
          prefix = $parent ? $parent + '.' + $prevKeyPrefix[i] : $prevKeyPrefix[i];
          primaryKeyAttributes = includeMap[prefix].model.primaryKeyAttributes;
          $length = primaryKeyAttributes.length;
          if ($length === 1) {
            itemHash = prefix + row[prefix + '.' + primaryKeyAttributes[0]];
          } else {
            itemHash = prefix;
            for ($i = 0; $i < $length; $i++) {
              itemHash += row[prefix + '.' + primaryKeyAttributes[$i]];
            }
          }
          if (!parentHash) {
            parentHash = topHash;
          }

          itemHash = parentHash + itemHash;
          $parent = prefix;
          if (i < length - 1) {
            parentHash = itemHash;
          }
        }
      } else {
        itemHash = topHash;
      }

      if (itemHash === topHash) {
        if (!resultMap[itemHash]) {
          resultMap[itemHash] = values;
        } else {
          topExists = true;
        }
      } else {
        if (!resultMap[itemHash]) {
          $parent = resultMap[parentHash];
          $lastKeyPrefix = lastKeyPrefix(prevKey);

          if (includeMap[prevKey].association.isSingleAssociation) {
            $parent[$lastKeyPrefix] = resultMap[itemHash] = values;
          } else {
            if (!$parent[$lastKeyPrefix]) {
              $parent[$lastKeyPrefix] = [];
            }
            $parent[$lastKeyPrefix].push(resultMap[itemHash] = values);
          }
        }
      }
      if (!topExists) {
        results.push(topValues);
      }
    } else {
      results[rowsI] = topValues;
    }
  }

  return results;
};

var groupJoinData = function (rows, includeOptions, options) {
  /*
       * Assumptions
       * ID is not necessarily the first field
       * All fields for a level is grouped in the same set (i.e. Panel.id, Task.id, Panel.title is not possible)
       * Parent keys will be seen before any include/child keys
       * Previous set won't necessarily be parent set (one parent could have two children, one child would then be previous set for the other)
       */
  
      /*
       * Author (MH) comment: This code is an unreadable mess, but it's performant.
       * groupJoinData is a performance critical function so we prioritize perf over readability.
       */
      if (!rows.length) {
        return [];
      }
  
      // Generic looping
      let i;
      let length;
      let $i;
      let $length;
      // Row specific looping
      let rowsI;
      let row;
      const rowsLength = rows.length;
      // Key specific looping
      let keys;
      let key;
      let keyI;
      let keysI;
      let keyLength;
      let prevKey;
      let values;
      let topValues;
      let topExists;
      const checkExisting = options.checkExisting;
      // If we don't have to deduplicate we can pre-allocate the resulting array
      let itemHash;
      let parentHash;
      let topHash;
      const results = checkExisting ? [] : new Array(rowsLength);
      const resultMap = {};
      const includeMap = {};
      // Result variables for the respective functions
      let $keyPrefix;
      let $keyPrefixString;
      let $prevKeyPrefixString; // eslint-disable-line
      let $prevKeyPrefix;
      let $lastKeyPrefix;
      let $current;
      let $parent;
      // Map each key to an include option
      let previousPiece;
      const buildIncludeMap = piece => {
        if (Object.prototype.hasOwnProperty.call($current.includeMap, piece)) {
          includeMap[key] = $current = $current.includeMap[piece];
          if (previousPiece) {
            previousPiece = `${previousPiece}.${piece}`;
          } else {
            previousPiece = piece;
          }
          includeMap[previousPiece] = $current;
        }
      };
      // Calculate the string prefix of a key ('User.Results' for 'User.Results.id')
      const keyPrefixStringMemo = {};
      const keyPrefixString = (key, memo) => {
        if (!Object.prototype.hasOwnProperty.call(memo, key)) {
          memo[key] = key.substr(0, key.lastIndexOf('.'));
        }
        return memo[key];
      };
      // Removes the prefix from a key ('id' for 'User.Results.id')
      const removeKeyPrefixMemo = {};
      const removeKeyPrefix = key => {
        if (!Object.prototype.hasOwnProperty.call(removeKeyPrefixMemo, key)) {
          const index = key.lastIndexOf('.');
          removeKeyPrefixMemo[key] = key.substr(index === -1 ? 0 : index + 1);
        }
        return removeKeyPrefixMemo[key];
      };
      // Calculates the array prefix of a key (['User', 'Results'] for 'User.Results.id')
      const keyPrefixMemo = {};
      const keyPrefix = key => {
        // We use a double memo and keyPrefixString so that different keys with the same prefix will receive the same array instead of differnet arrays with equal values
        if (!Object.prototype.hasOwnProperty.call(keyPrefixMemo, key)) {
          const prefixString = keyPrefixString(key, keyPrefixStringMemo);
          if (!Object.prototype.hasOwnProperty.call(keyPrefixMemo, prefixString)) {
            keyPrefixMemo[prefixString] = prefixString ? prefixString.split('.') : [];
          }
          keyPrefixMemo[key] = keyPrefixMemo[prefixString];
        }
        return keyPrefixMemo[key];
      };
      // Calcuate the last item in the array prefix ('Results' for 'User.Results.id')
      const lastKeyPrefixMemo = {};
      const lastKeyPrefix = key => {
        if (!Object.prototype.hasOwnProperty.call(lastKeyPrefixMemo, key)) {
          const prefix = keyPrefix(key);
          const length = prefix.length;
  
          lastKeyPrefixMemo[key] = !length ? '' : prefix[length - 1];
        }
        return lastKeyPrefixMemo[key];
      };
      const getUniqueKeyAttributes = model => {
        let uniqueKeyAttributes = _.chain(model.uniqueKeys);
        uniqueKeyAttributes = uniqueKeyAttributes
          .result(`${uniqueKeyAttributes.findKey()}.fields`)
          .map(field => _.findKey(model.attributes, chr => chr.field === field))
          .value();
  
        return uniqueKeyAttributes;
      };
      const stringify = obj => obj instanceof Buffer ? obj.toString('hex') : obj;
      const cleanRowNumRows = rows => {
        for (rowsI = 0; rowsI < rowsLength; rowsI++) {
          let rownum = `ROWNUM_${rowsI+1}`;
          delete rows[rowsI][rownum];
        }
      };
      const sortKeysPrefix = keys => {
        let simpleKeys = [];
        let complexKeys = [];
        for (keysI = 0; keysI < keys.length; keysI++) {
          if (keys[keysI].indexOf(".") < 0) {
            simpleKeys.push(keys[keysI]);
          } else {
            complexKeys.push(keys[keysI]);
          }
        }
        return simpleKeys.concat(complexKeys);
      };
      let primaryKeyAttributes;
      let uniqueKeyAttributes;
      let prefix;
      cleanRowNumRows(rows);
      for (rowsI = 0; rowsI < rowsLength; rowsI++) {
        row = rows[rowsI];
  
        // Keys are the same for all rows, so only need to compute them on the first row
        if (rowsI === 0) {
          keys = sortKeysPrefix(Object.keys(row));
          keyLength = keys.length;
        }
  
        if (checkExisting) {
          topExists = false;
  
          // Compute top level hash key (this is usually just the primary key values)
          $length = includeOptions.model.primaryKeyAttributes.length;
          topHash = '';
          if ($length === 1) {
            topHash = stringify(row[includeOptions.model.primaryKeyAttributes[0]]);
          }
          else if ($length > 1) {
            for ($i = 0; $i < $length; $i++) {
              topHash += stringify(row[includeOptions.model.primaryKeyAttributes[$i]]);
            }
          }
          else if (!_.isEmpty(includeOptions.model.uniqueKeys)) {
            uniqueKeyAttributes = getUniqueKeyAttributes(includeOptions.model);
            for ($i = 0; $i < uniqueKeyAttributes.length; $i++) {
              topHash += row[uniqueKeyAttributes[$i]];
            }
          }
        }
  
        topValues = values = {};
        $prevKeyPrefix = undefined;
        for (keyI = 0; keyI < keyLength; keyI++) {
          key = keys[keyI];
  
          // The string prefix isn't actualy needed
          // We use it so keyPrefix for different keys will resolve to the same array if they have the same prefix
          // TODO: Find a better way?
          $keyPrefixString = keyPrefixString(key, keyPrefixStringMemo);
          $keyPrefix = keyPrefix(key);
  
          // On the first row we compute the includeMap
          if (rowsI === 0 && !Object.prototype.hasOwnProperty.call(includeMap, key)) {
            if (!$keyPrefix.length) {
              includeMap[key] = includeMap[''] = includeOptions;
            } else {
              $current = includeOptions;
              previousPiece = undefined;
              $keyPrefix.forEach(buildIncludeMap);
            }
          }
          // End of key set
          if ($prevKeyPrefix !== undefined && $prevKeyPrefix !== $keyPrefix) {
            if (checkExisting) {
              // Compute hash key for this set instance
              // TODO: Optimize
              length = $prevKeyPrefix.length;
              $parent = null;
              parentHash = null;
  
              if (length) {
                for (i = 0; i < length; i++) {
                  prefix = $parent ? `${$parent}.${$prevKeyPrefix[i]}` : $prevKeyPrefix[i];
                  primaryKeyAttributes = includeMap[prefix].model.primaryKeyAttributes;
                  $length = primaryKeyAttributes.length;
                  itemHash = prefix;
                  if ($length === 1) {
                    itemHash += stringify(row[`${prefix}.${primaryKeyAttributes[0]}`]);//////
                  }
                  else if ($length > 1) {
                    for ($i = 0; $i < $length; $i++) {
                      itemHash += stringify(row[`${prefix}.${primaryKeyAttributes[$i]}`]);
                    }
                  }
                  else if (!_.isEmpty(includeMap[prefix].model.uniqueKeys)) {
                    uniqueKeyAttributes = getUniqueKeyAttributes(includeMap[prefix].model);
                    for ($i = 0; $i < uniqueKeyAttributes.length; $i++) {
                      itemHash += row[`${prefix}.${uniqueKeyAttributes[$i]}`];
                    }
                  }
                  if (!parentHash) {
                    parentHash = topHash;
                  }
  
                  itemHash = parentHash + itemHash;
                  $parent = prefix;
                  if (i < length - 1) {
                    parentHash = itemHash;
                  }
                }
              } else {
                itemHash = topHash;
              }
  
              if (itemHash === topHash) {
                if (!resultMap[itemHash]) {
                  resultMap[itemHash] = values;
                } else {
                  topExists = true;
                }
              } else if (!resultMap[itemHash]) {
                $parent = resultMap[parentHash];// Comprobar resultMap
                $lastKeyPrefix = lastKeyPrefix(prevKey);
  
                if (includeMap[prevKey].association.isSingleAssociation) {
                  if ($parent) {
                    $parent[$lastKeyPrefix] = resultMap[itemHash] = values;
                  }
                } else {
                  if (!$parent[$lastKeyPrefix]) {
                    $parent[$lastKeyPrefix] = [];
                  }
                  $parent[$lastKeyPrefix].push(resultMap[itemHash] = values);
                }
              }
  
              // Reset values
              values = {};
            } else {
              // If checkExisting is false it's because there's only 1:1 associations in this query
              // However we still need to map onto the appropriate parent
              // For 1:1 we map forward, initializing the value object on the parent to be filled in the next iterations of the loop
              $current = topValues;
              length = $keyPrefix.length;
              if (length) {
                for (i = 0; i < length; i++) {
                  if (i === length - 1) {
                    values = $current[$keyPrefix[i]] = {};
                  }
                  $current = $current[$keyPrefix[i]] || {};
                }
              }
            }
          }
  
          // End of iteration, set value and set prev values (for next iteration)
          values[removeKeyPrefix(key)] = row[key];
          prevKey = key;
          $prevKeyPrefix = $keyPrefix;
          $prevKeyPrefixString = $keyPrefixString;
        }
  
        if (checkExisting) {
          length = $prevKeyPrefix.length;
          $parent = null;
          parentHash = null;
  
          if (length) {
            for (i = 0; i < length; i++) {
              prefix = $parent ? `${$parent}.${$prevKeyPrefix[i]}` : $prevKeyPrefix[i];
              primaryKeyAttributes = includeMap[prefix].model.primaryKeyAttributes;
              $length = primaryKeyAttributes.length;
              itemHash = prefix;
              if ($length === 1) {
                itemHash += stringify(row[`${prefix}.${primaryKeyAttributes[0]}`]);
              }
              else if ($length > 0) {
                for ($i = 0; $i < $length; $i++) {
                  itemHash += stringify(row[`${prefix}.${primaryKeyAttributes[$i]}`]);
                }
              }
              else if (!_.isEmpty(includeMap[prefix].model.uniqueKeys)) {
                uniqueKeyAttributes = getUniqueKeyAttributes(includeMap[prefix].model);
                for ($i = 0; $i < uniqueKeyAttributes.length; $i++) {
                  itemHash += row[`${prefix}.${uniqueKeyAttributes[$i]}`];
                }
              }
              if (!parentHash) {
                parentHash = topHash;
              }
  
              itemHash = parentHash + itemHash;
              $parent = prefix;
              if (i < length - 1) {
                parentHash = itemHash;
              }
            }
          } else {
            itemHash = topHash;
          }
  
          if (itemHash === topHash) {
            if (!resultMap[itemHash]) {
              resultMap[itemHash] = values;
            } else {
              topExists = true;
            }
          } else if (!resultMap[itemHash]) {
            $parent = resultMap[parentHash];
            $lastKeyPrefix = lastKeyPrefix(prevKey);
  
            if (includeMap[prevKey].association.isSingleAssociation) {
              if ($parent) {
                $parent[$lastKeyPrefix] = resultMap[itemHash] = values;
              }
            } else {
              if (!$parent[$lastKeyPrefix]) {
                $parent[$lastKeyPrefix] = [];
              }
              $parent[$lastKeyPrefix].push(resultMap[itemHash] = values);
            }
          }
          if (!topExists) {
            results.push(topValues);
          }
        } else {
          results[rowsI] = topValues;
        }
      }
  
      return results;
  };

/**
 * Execute the passed sql query.
 *
 * Examples:
 *
 *     query.run('SELECT 1')
 *
 * @param {String} sql - The SQL query which should be executed.
 * @api public
 */
AbstractQuery.prototype.run = function () {
  throw new Error('The run method wasn\'t overwritten!');
};

/**
 * Check the logging option of the instance and print deprecation warnings.
 *
 * @return {void}
 */
AbstractQuery.prototype.checkLoggingOption = function () {
  if (this.options.logging === true) {
    console.log('DEPRECATION WARNING: The logging-option should be either a function or false. Default: console.log');
    this.options.logging = console.log;
  }

  if (this.options.logging === console.log) {
    // using just console.log will break in node < 0.6
    this.options.logging = function (s) {
      console.log(s);
    };
  }
};

/**
 * Get the attributes of an insert query, which contains the just inserted id.
 *
 * @return {String} The field name.
 */
AbstractQuery.prototype.getInsertIdField = function () {
  return 'insertId';
};

/**
 * Iterate over all known tables and search their names inside the sql query.
 * This method will also check association aliases ('as' option).
 *
 * @param  {String} attribute An attribute of a SQL query. (?)
 * @return {String}           The found tableName / alias.
 */
AbstractQuery.prototype.findTableNameInAttribute = function (attribute) {
  if (!this.options.include) {
    return null;
  }
  if (!this.options.includeNames) {
    this.options.includeNames = this.options.include.map(function (include) {
      return include.as;
    });
  }

  var tableNames = this.options.includeNames.filter(function (include) {
    return attribute.indexOf(include + '.') === 0;
  });

  if (tableNames.length === 1) {
    return tableNames[0];
  } else {
    return null;
  }
};

AbstractQuery.prototype.getUniqueConstraintErrorMessage = function (field) {
  var message = field + ' must be unique';
  var self = this;
  Object.keys(self.model.uniqueKeys).forEach(function (key) {
    if (self.model.uniqueKeys[key].fields.indexOf(field.replace(/"/g, '')) >= 0) {
      if (self.model.uniqueKeys[key].hasOwnProperty('msg')) {
        message = self.model.uniqueKeys[key].msg;
      }
    }
  });
  return message;
};

AbstractQuery.prototype.isRawQuery = function () {
  return this.options.type === QueryTypes.RAW;
};

AbstractQuery.prototype.isVersionQuery = function () {
  return this.options.type === QueryTypes.VERSION;
};

AbstractQuery.prototype.isUpsertQuery = function () {
  return this.options.type === QueryTypes.UPSERT;
};

AbstractQuery.prototype.isInsertQuery = function (results, metaData) {
  var result = true;

  if (this.options.type === QueryTypes.INSERT) {
    return true;
  }

  // is insert query if sql contains insert into
  result = result && (this.sql.toLowerCase().indexOf('insert into') === 0);

  // is insert query if no results are passed or if the result has the inserted id
  result = result && (!results || results.hasOwnProperty(this.getInsertIdField()));

  // is insert query if no metadata are passed or if the metadata has the inserted id
  result = result && (!metaData || metaData.hasOwnProperty(this.getInsertIdField()));

  return result;
};

AbstractQuery.prototype.handleInsertQuery = function (results, metaData) {
  if (this.instance) {
    // add the inserted row id to the instance
    var autoIncrementField = this.model.autoIncrementField,
      id = null;

    id = id || (results && results[this.getInsertIdField()]);
    id = id || (metaData && metaData[this.getInsertIdField()]);

    this.instance[autoIncrementField] = id;
  }
};

AbstractQuery.prototype.isShowTablesQuery = function () {
  return this.options.type === QueryTypes.SHOWTABLES;
};

AbstractQuery.prototype.handleShowTablesQuery = function (results) {
  return Utils._.flatten(results.map(function (resultSet) {
    return Utils._.values(resultSet);
  }));
};

AbstractQuery.prototype.isShowIndexesQuery = function () {
  return this.options.type === QueryTypes.SHOWINDEXES;
};

AbstractQuery.prototype.isDescribeQuery = function () {
  return this.options.type === QueryTypes.DESCRIBE;
};

AbstractQuery.prototype.isSelectQuery = function () {
  return this.options.type === QueryTypes.SELECT;
};

AbstractQuery.prototype.isBulkUpdateQuery = function () {
  return this.options.type === QueryTypes.BULKUPDATE;
};

AbstractQuery.prototype.isBulkDeleteQuery = function () {
  return this.options.type === QueryTypes.BULKDELETE;
};

AbstractQuery.prototype.isForeignKeysQuery = function () {
  return this.options.type === QueryTypes.FOREIGNKEYS;
};

AbstractQuery.prototype.isUpdateQuery = function () {
  return this.options.type === QueryTypes.UPDATE;
};

AbstractQuery.prototype.handleSelectQuery = function (results) {
  var result = null;

  // console.log('================handleSelectQuery=================');
  // console.log(results);
  // console.log('================attributes=================');
  // console.log(this.options.attributes);

  var _UpperCaseAttrs = JSON.stringify(this.options.attributes);
  if(typeof _UpperCaseAttrs !== "String"){
    _UpperCaseAttrs = "[]";
  }
  _UpperCaseAttrs = JSON.parse(_UpperCaseAttrs);
  // console.warn('-=-=-=-=-=-=-=-=-=-=-==-=');
  // console.warn(_UpperCaseAttrs);
  // if (_UpperCaseAttrs[0]) {
  //   console.warn(_UpperCaseAttrs[0]);
  //   console.warn(typeof _UpperCaseAttrs[0]);
  // }

  results = results.map(result => {
    var attrs = Utils._.flattenDeep(this.options.attributes);
    _UpperCaseAttrs = Utils._.flattenDeep(_UpperCaseAttrs);
    // console.warn(attrs);
    for (var key in result) {
      var idx = _UpperCaseAttrs.indexOf(key);
      if (idx != -1) {
        result[attrs[idx]] = result[_UpperCaseAttrs[idx]];
        delete result[_UpperCaseAttrs[idx]];
      }
    }
    return result;
  })
  // console.warn(results);
  // Raw queries
  if (this.options.raw) {
    // console.warn('-=-=-=-=-=-=-=this.options.raw-=-=-=-=-=-=-=-');
    result = results.map(function (result) {
      var o = {};

      for (var key in result) {
        if (result.hasOwnProperty(key)) {
          o[key] = result[key];
        }
      }
      if (this.options.nest) {
        o = Dot.transform(o);
      }

      return o;
    }, this);
    // Queries with include
  } else if (this.options.hasJoin === true) {
    // console.warn('-=-=-=-=-=-=-=this.options.hasJoin === true-=-=-=-=-=-=-=-');
    results = groupJoinData(results, {
      model: this.model,
      includeMap: this.options.includeMap,
      includeNames: this.options.includeNames
    }, {
      checkExisting: this.options.hasMultiAssociation
    });

    result = this.model.bulkBuild(results, {
      isNewRecord: false,
      include: this.options.include,
      includeNames: this.options.includeNames,
      includeMap: this.options.includeMap,
      includeValidated: true,
      attributes: this.options.originalAttributes || this.options.attributes,
      raw: true
    });
    // Regular queries
  } else {
    // console.warn('-=-=-=-=-=-=-= else else else -=-=-=-=-=-=-=-');

    // console.warn(results);
    result = this.model.bulkBuild(results, {
      isNewRecord: false,
      raw: true,
      attributes: this.options.attributes
    });
  }

  /**
   * 重写 bulkBuild 方法
   * bulkBuildIgnoreCase
   * auth: legion
   */
  // function bulkBuildIgnoreCase(results, params) {

  // }

  // return the first real model instance if options.plain is set (e.g. Model.find)
  if (this.options.plain) {
    result = (result.length === 0) ? null : result[0];
  }

  return result;
};

AbstractQuery.prototype.isShowOrDescribeQuery = function () {
  var result = false;

  result = result || (this.sql.toLowerCase().indexOf('show') === 0);
  result = result || (this.sql.toLowerCase().indexOf('describe') === 0);

  return result;
};

AbstractQuery.prototype.isCallQuery = function () {
  var result = false;

  result = result || (this.sql.toLowerCase().indexOf('call') === 0);

  return result;
};

AbstractQuery.$groupJoinData = groupJoinData;

module.exports = AbstractQuery;