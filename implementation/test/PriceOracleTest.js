import increaseTime from './helpers/increaseTime'
import BN from 'bn.js'

const chai = require('chai')
const expect = chai.expect
const bnChai = require('bn-chai')
chai.use(bnChai(BN))

const PriceOracleV1 = artifacts.require('PriceOracleV1')

contract('PriceOracleV1', function(accounts) {
  const DEFAULT_OPERATOR = accounts[0]

  // 1 BTC : 32.32 ETH
  const DEFAULT_PRICE = new BN('323200000000')

  const PRICE_EXPIRY_SECONDS = 21600 // 6 hours = 21600 seconds

  describe('#constructor', () => {
    it('deploys', async () => {
      const instance = await PriceOracleV1.deployed()

      const price = await instance.getPrice()
      expect(price).to.eq.BN(DEFAULT_PRICE)

      const operator = await instance.operator()
      assert.equal(operator, accounts[0])
    })

    it('sets price expiry correctly', async () => {
      const instance = await PriceOracleV1.new(DEFAULT_OPERATOR, DEFAULT_PRICE)

      const deployBlockNumber = (await web3.eth.getTransaction(instance.transactionHash)).blockNumber
      const deployTimestamp = (await web3.eth.getBlock(deployBlockNumber)).timestamp
      const expectedPriceExpiryTime = new BN(deployTimestamp).add(new BN(PRICE_EXPIRY_SECONDS))

      const priceExpiryTime = await instance.priceExpiryTime()
      expect(priceExpiryTime).to.eq.BN(expectedPriceExpiryTime)
    })
  })

  describe('Methods', () => {
    describe('#getPrice', () => {
      let instance

      beforeEach(async () => {
        instance = await PriceOracleV1.new(
          DEFAULT_OPERATOR,
          DEFAULT_PRICE
        )
      })

      it('returns a default price', async () => {
        const res = await instance.getPrice.call()
        expect(res).to.eq.BN(DEFAULT_PRICE)
      })

      it('fails when the price is expired', async () => {
        await increaseTime(PRICE_EXPIRY_SECONDS + 1)

        try {
          await instance.getPrice.call()

          assert(false, 'Test call did not error as expected')
        } catch (e) {
          assert.include(e.message, 'Price expired')
        }
      })
    })

    describe('#updatePrice', () => {
      it('sets new price', async () => {
        const newPrice = DEFAULT_PRICE.mul(new BN('2'))

        const instance = await PriceOracleV1.new(
          DEFAULT_OPERATOR,
          DEFAULT_PRICE
        )

        const tx = await instance.updatePrice(newPrice)
        const block = await web3.eth.getBlock(tx.receipt.blockNumber)

        const priceExpiryTime = await instance.priceExpiryTime.call()

        assert.equal(
          priceExpiryTime.toNumber(), block.timestamp + PRICE_EXPIRY_SECONDS
        )

        const res = await instance.getPrice.call()
        expect(res).to.eq.BN(newPrice)
      })

      describe.only('1% minimum price delta', async () => {
        // DO NOT try to use BN.js, it is a sinkhole of time
        // These test cases were created using `bc`
        // An example:
        // $ bc
        // scale=100
        // 323200000000/100
        // etc.

        let instance
        const initialPrice = new BN('323200000000')

        // delta = 3 231 999 999 (< 1%)
        const price11 = new BN('326431999999')
        const price12 = new BN('319968000001')
        // delta = 3 232 000 000 (1%)
        const price21 = new BN('326432000000')
        const price22 = new BN('319968000000')
        // delta = 3 232 000 001 (> 1%)
        const price31 = new BN('326432000001')
        const price32 = new BN('319967999999')

        beforeEach(async () => {
          instance = await PriceOracleV1.new(
            DEFAULT_OPERATOR,
            initialPrice
          )
        })

        describe('less than 1% delta', async () => {
          it('fails price increase', async () => {
            try {
              await instance.updatePrice(price11)
              assert(false, 'Test call did not error as expected')
            } catch (e) {
              assert.include(e.message, 'Price change is negligible (<1%)')
            }
          })
          it('fails price decrease', async () => {
            try {
              await instance.updatePrice(price12)
              assert(false, 'Test call did not error as expected')
            } catch (e) {
              assert.include(e.message, 'Price change is negligible (<1%)')
            }
          })
        })

        describe('equal to 1% delta', async () => {
          it('passes price increase', async () => {
            await instance.updatePrice(price21)
          })
          it('passes price decrease', async () => {
            await instance.updatePrice(price22)
          })
        })

        describe('greater than 1% delta', async () => {
          it('passes price increase', async () => {
            await instance.updatePrice(price31)
          })

          it('passes price decrease', async () => {
            await instance.updatePrice(price32)
          })
        })
      })

      it('fails when msg.sender != operator', async () => {
        const instance = await PriceOracleV1.new(
          DEFAULT_OPERATOR,
          DEFAULT_PRICE
        )

        try {
          await instance.updatePrice(
            new BN('323200000001'),
            { from: accounts[1] }
          )

          assert(false, 'Test call did not error as expected')
        } catch (e) {
          assert.include(e.message, 'Unauthorised')
        }
      })

      it('ignores 1% threshold for update, when the price is close to expiry', async () => {
        const instance = await PriceOracleV1.new(
          DEFAULT_OPERATOR,
          new BN('1')
        )
        const price1 = new BN('323200000001')
        const price2 = new BN('323200000010')

        await instance.updatePrice(price1)

        try {
          await instance.updatePrice(price2)
          assert(false, 'Test call did not error as expected')
        } catch (e) {
          assert.include(e.message, 'Price change is negligible (<1%)')
        }

        const ONE_HOUR = 3600
        await increaseTime(PRICE_EXPIRY_SECONDS - ONE_HOUR)

        await instance.updatePrice(price2)
        const res = await instance.getPrice.call()
        assert(res.eq(price2))
      })
    })
  })
})