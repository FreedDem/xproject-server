import jwt from 'jsonwebtoken'

export function signAdminToken(){
  const secret = process.env.ADMIN_PASSWORD
  if (!secret) throw new Error('ADMIN_PASSWORD is not set')
  return jwt.sign({ role: 'admin' }, secret, { expiresIn: '7d' })
}

export function requireAdmin(req, res, next){
  try{
    const secret = process.env.ADMIN_PASSWORD
    if (!secret) return res.status(500).send('ADMIN_PASSWORD is not set')
    const h = req.headers.authorization || ''
    const token = h.startsWith('Bearer ') ? h.slice(7) : null
    if (!token) return res.status(401).send('Unauthorized')
    jwt.verify(token, secret)
    req.user = { isAdmin: true }
    next()
  }catch{
    res.status(401).send('Unauthorized')
  }
}
