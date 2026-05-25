import jindalLogo from '../../assets/Jindal_Logo.jpg'

const sizeMap = {
  sm: 'h-10',
  md: 'h-14',
  lg: 'h-20',
}

export default function JDILLogo({ size = 'md' }) {
  return (
    <img
      src={jindalLogo}
      alt="Jindal Drilling & Industries Ltd."
      className={`${sizeMap[size] || sizeMap.md} w-auto object-contain`}
    />
  )
}
