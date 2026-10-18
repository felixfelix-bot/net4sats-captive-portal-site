// external
import { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';

// internal
import LanguageSwitcher from './LanguageSwitcher';
import DeviceInfo from './DeviceInfo';
import { Error, Success } from './Status';
import { Processing, AccessGranted, AccessOptions } from '../App'
import { CancelIcon } from './Icon'

// helpers
import { requestScanQr } from '../helpers/qr-code';
import { requestPaste } from '../helpers/clipboard';
import { getAccessOptions, calculateAllocation } from '../helpers/net4sats';
import { validateToken, submitToken } from '../helpers/cashu';

// styles and assets
import './Cashu.scss'

// main component for cashu payment method
export const Cashu = (props) => {
  const { t } = useTranslation();
  const { net4satsDetails } = props;
  // state for user input and payment flow
  const [token, setToken] = useState('');
  const [tokenValue, setTokenValue] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [accessOptions, setAccessOptions] = useState([])
  const [allocation, setAllocation] = useState(null)
  const [selectedMint, setSelectedMint] = useState(null)

  // set access options if net4sats details are set
  useEffect(() => {
    const options = getAccessOptions(net4satsDetails.detailsEvent, t);
    if (options.length) {
      setAccessOptions(options);
      setSelectedMint(options[0])
      // for development purposes
      // setTimeout(() => {
      //   // 420 stats
      //   // setToken('cashuB<redacted>')
      //   // 500 sats
      //   setToken('cashuB<redacted>')
      // }, 100)
    } else {
      setError({
        status: 0,
        code: 'CU001',
        label: t('CU001_label'),
        message: t('CU001_message')
      })
    }
  }, [net4satsDetails])

  // handle token change: validate and calculate allocation.
  // validateToken is async: decoding a modern token needs the mint's keysets, which
  // have to be fetched. Sequence the result against the current token so a slow
  // fetch cannot overwrite the state produced by a newer paste.
  useEffect(() => {
    if (token) {
      let cancelled = false;
      (async () => {
        const validation = await validateToken(token, selectedMint, t, accessOptions);
        if (cancelled) return;
        if (!validation.status) {
        setError(validation)
        setTokenValue(null)
      } else {
        setTokenValue(validation.value)
        setAllocation(calculateAllocation(validation.value.amount, selectedMint, t))
        if (validation.value.amount < selectedMint.price) {
          setError({
            status: 0,
            code: 'CU002',
            label: t('CU002_label'),
            message: t('CU002_message')
          })
        } else {
          setError(null)
        }
      }
      })()
      return () => { cancelled = true }
    } else {
      setTokenValue(null)
      setAllocation(null)
      setError(null)
    }
  }, [token])

  // handle mint change: recalculate allocation and error
  useEffect(() => {
    if (selectedMint && tokenValue && tokenValue.amount) {
      if (tokenValue.amount < selectedMint.price) {
        setError({
          status: 0,
          code: 'CU002',
          label: t('CU002_label'),
          message: t('CU002_message')
        })
      } else {
        setError(null);
      }
      setAllocation(calculateAllocation(tokenValue.amount, selectedMint, t))
    }
  }, [selectedMint])

  // handle processing state: submit token and handle result
  useEffect(() => {
    if (processing) {
      const submit = async () => {
        const response = await submitToken(token, net4satsDetails, allocation, t);
        setProcessing(false);

        if (response.status) {
          setSuccess(true);
        } else {
          setError(response)
        }
      }

      submit()
    }
  }, [processing])

  // render the cashu payment form and flow
  return (
    <div className="net4sats-captive-portal-method-cashu net4sats-captive-portal-method">
      {/* header: shows the portal title and a short description about cashu */}
      {(!success && !processing) && <Header />}

      <div className="net4sats-captive-portal-method-content">
        {/* processing: displays a loading indicator and message while payment is being processed */}
        {(!success && processing) && <Processing label={t('processing_payment')} />}

        {/* accessgranted: shows a success message and the amount of access granted after a successful payment */}
        {(success && !processing) && <AccessGranted allocation={`${allocation.value} ${allocation.unit}`} />}

        {/* tokeninput: input field and actions for entering or scanning a cashu token */}
        {(!success && !processing && accessOptions.length) && <TokenInput token={token} setToken={setToken} scanning={scanning} setScanning={setScanning} setError={setError} />}

        {/* success: displays a message when a valid cashu token is detected, before purchase */}
        {(!success && !processing && tokenValue) && <Success
          label={t('valid_cashu_token')}
          info={tokenValue.amount !== 1 ? t('sat_plural', { count: tokenValue.amount }) : t('sat', { count: tokenValue.amount })}
          message={t('valid_cashu_token_message', { purchased: `${allocation.value} ${allocation.unit}` })}
        />}

        {/* error: shows error messages for invalid tokens or other issues */}
        {error && <Error label={error.label} code={error.code} message={error.message} />}

        {/* accessoptions: lets the user select from available access/pricing options */}
        {(!success && !processing && accessOptions.length) && <div className="net4sats-captive-portal-method-options">
          <h5>{t('access_options')}</h5>
          <AccessOptions
            pricingInfo={accessOptions}
            selectedMint={selectedMint}
            setSelectedMint={setSelectedMint}
          />
        </div>}

        {/* purchase button: only enabled if token is valid and no error */}
        {!success && !processing && <div className="net4sats-captive-portal-method-submit">
          {(!tokenValue || error) && <button disabled>{t('purchase')}</button>}
          {(tokenValue && !processing && !error) && (() => {
            return <button
              className="cta"
              dangerouslySetInnerHTML={{
                __html:
                  selectedMint ?
                    t('purchase_filled', {
                      price: `<strong>${tokenValue.amount} ${tokenValue.unit}</strong>`,
                      unit: `<strong>${allocation.value} ${allocation.unit}</strong>`
                    }) :
                    t('purchase')
              }}
              onClick={() => setProcessing(true)} />
          })()}
        </div>}

      </div>

      <div className="net4sats-captive-portal-method-footer">
        <DeviceInfo net4satsDetails={net4satsDetails} />
        <LanguageSwitcher />
      </div>
    </div>
  );
}

// cashu header component
const Header = () => {
  const { t } = useTranslation();
  return <div className="net4sats-captive-portal-method-header">
    <h1>{t('portal_title')}</h1>
    <h2><Trans i18nKey="provide_cashu" components={{ 1: <a href="https://cashu.space/" target="_blank" rel="noreferrer"></a> }} /></h2>
  </div>
}

// token input component for entering or scanning a cashu token
const TokenInput = ({ token, setToken, scanning, setScanning, setError }) => {
  const { t } = useTranslation();
  return (
    <div className="net4sats-captive-portal-method-input">
      <input
        value={token}
        placeholder={t('cashu_input_placeholder')}
        type="text"
        id="cashu-token"
        onChange={(e) => setToken(e.target.value)}
      ></input>
      <div className="net4sats-captive-portal-method-input-actions">
        {token.length ? <>
          {/* reset button to clear the input */}
          <button className="small cancel" onClick={() => {
            setToken('')
          }}><CancelIcon /></button>
        </> : <>
          {/* paste from clipboard button */}
          <button className="ghost cta small ellipsis" onClick={async (input) => {
            const paste = await requestPaste(t);
            if (paste.status) {
              setToken(paste.value)
            } else {
              setError(paste)
            }
          }}>{t('paste')}</button>
          {/* scan qr code button */}
          <button className="ghost cta small ellipsis" onClick={async () => {
            if (scanning) return;
            setScanning(true);
            const response = await requestScanQr(t);
            if (response.status) {
              setToken(response.value)
            } else {
              // check the code as we can receive 0 which means no error needed
              if (response.code) {
                setError(response)
              }
            }
            setScanning(false);
          }} disabled={scanning}>
            {scanning ? t('scanning') : t('scan_qr')}
          </button>
        </>}
      </div>
    </div>
  )
}

export default Cashu