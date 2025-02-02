import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import { BlockMetricEntity } from '@app/orm/entities/block-metric.entity'
import { AggregateBlockMetric, BlockMetricField, TimeBucket } from '@app/graphql/schema'
import { unitOfTime } from 'moment'
import moment = require('moment')
import { BlockHeaderEntity } from '@app/orm/entities/block-header.entity'
import BigNumber from 'bignumber.js'

@Injectable()
export class BlockMetricsService {

  constructor(@InjectRepository(BlockHeaderEntity)
              private readonly blockHeaderRepository: Repository<BlockHeaderEntity>,
              @InjectRepository(BlockMetricEntity)
              private readonly blockMetricsRepository: Repository<BlockMetricEntity>) {
  }

  async findByBlockHash(blockHashes: string[]): Promise<BlockMetricEntity[]> {
    return this.blockMetricsRepository
      .find({
        where: {
          blockHash: In(blockHashes),
        },
      })
  }

  async find(offset: number, limit: number): Promise<[BlockMetricEntity[], number]> {

    const items = await this.blockMetricsRepository
      .find({
        order: { number: 'DESC' },
        skip: offset,
        take: limit,
      })

    // much cheaper to do the count against canonical block header table instead of using the
    // usual count mechanism
    const count = await this.blockHeaderRepository
      .count()

    items.forEach(item => {
      // if there is no txs these fields can be null
      item.totalTxFees = item.totalTxFees || new BigNumber(0)
      item.avgTxFees = item.avgTxFees || new BigNumber(0)
    })

    return [items, count]
  }

  private estimateDatapoints(start: Date, end: Date, bucket: TimeBucket): number {

    const startMoment = moment(start)
    const endMoment = moment(end)

    let timeUnit: unitOfTime.Diff
    switch (bucket) {
      case TimeBucket.ONE_HOUR:
        timeUnit = 'hours'
        break
      case TimeBucket.ONE_DAY:
        timeUnit = 'days'
        break
      case TimeBucket.ONE_WEEK:
        timeUnit = 'weeks'
        break
      case TimeBucket.ONE_MONTH:
        timeUnit = 'months'
        break
      case TimeBucket.ONE_YEAR:
        timeUnit = 'years'
        break
      default:
        throw new Error(`Unexpected time bucket: ${bucket}`)
    }

    return startMoment.diff(endMoment, timeUnit)
  }

  async timeseries(
    start: Date,
    end: Date,
    bucket: TimeBucket,
    fields: BlockMetricField[],
  ): Promise<AggregateBlockMetric[]> {

    const datapoints = this.estimateDatapoints(start, end, bucket)

    if (datapoints > 10000) {
      throw new Error('Estimated datapoints exceeds 10,000. Try refining your date range or adjusting your time bucket')
    }

    const select: string[] = []

    switch (bucket) {
      case TimeBucket.ONE_HOUR:
        select.push('time_bucket(\'1 hour\', timestamp) as time')
        break
      case TimeBucket.ONE_DAY:
        select.push('time_bucket(\'1 day\', timestamp) as time')
        break
      case TimeBucket.ONE_WEEK:
        select.push('time_bucket(\'1 week\', timestamp) as time')
        break
      case TimeBucket.ONE_MONTH:
        select.push('time_bucket(\'1 month\', timestamp) as time')
        break
      case TimeBucket.ONE_YEAR:
        select.push('time_bucket(\'1 year\', timestamp) as time')
        break
      default:
        throw new Error(`Unexpected bucket value: ${bucket}`)
    }

    fields.forEach(m => {
      switch (m) {
        case BlockMetricField.AVG_BLOCK_TIME:
          select.push('round(avg(block_time)) as avg_block_time')
          break
        case BlockMetricField.AVG_NUM_UNCLES:
          select.push('round(avg(num_uncles)) as avg_num_uncles')
          break
        case BlockMetricField.AVG_DIFFICULTY:
          select.push('round(avg(difficulty)) as avg_difficulty')
          break
        case BlockMetricField.AVG_TOTAL_DIFFICULTY:
          select.push('round(avg(total_difficulty)) as avg_total_difficulty')
          break
        case BlockMetricField.AVG_GAS_LIMIT:
          select.push('round(avg(avg_gas_limit)) as avg_gas_limit')
          break
        case BlockMetricField.AVG_GAS_PRICE:
          select.push('round(avg(avg_gas_price)) as avg_gas_price')
          break
        case BlockMetricField.AVG_NUM_TXS:
          select.push('round(avg(total_txs)) as avg_num_txs')
          break
        case BlockMetricField.AVG_NUM_SUCCESSFUL_TXS:
          select.push('round(avg(num_successful_txs)) as avg_num_successful_txs')
          break
        case BlockMetricField.AVG_NUM_FAILED_TXS:
          select.push('round(avg(num_failed_txs)) as avg_num_failed_txs')
          break
        case BlockMetricField.AVG_NUM_INTERNAL_TXS:
          select.push('round(avg(num_internal_txs)) as avg_num_internal_txs')
          break
        case BlockMetricField.AVG_TX_FEES:
          select.push('round(avg(avg_tx_fees)) as avg_tx_fees')
          break
        case BlockMetricField.AVG_TOTAL_TX_FEES:
          select.push('round(avg(total_tx_fees)) as avg_total_tx_fees')
          break
        default:
          throw new Error(`Unexpected metric: ${m}`)
      }
    })

    const items = await this.blockMetricsRepository
      .createQueryBuilder('bm')
      .select(select)
      .where('timestamp between :end and :start')
      .groupBy('time')
      .orderBy({ time: 'DESC' })
      .setParameters({ start, end })
      .getRawMany()

    return items.map(item => {

      return {
        timestamp: item.time,
        avgBlockTime: item.avg_block_time,
        avgNumUncles: item.avg_num_uncles,
        avgDifficulty: item.avg_difficulty,
        avgTotalDifficulty: item.avg_total_difficulty,
        avgGasLimit: item.avg_gas_limit,
        avgGasPrice: item.avg_gas_price,
        avgNumTxs: item.avg_num_txs,
        avgNumSuccessfulTxs: item.avg_num_successful_txs,
        avgNumFailedTxs: item.avg_num_failed_txs,
        avgNumInternalTxs: item.avg_num_internal_txs,
        avgTxFees: item.avg_tx_fees,
        avgTotalTxFees: item.avg_total_tx_fees,
      } as AggregateBlockMetric

    })
  }

}
