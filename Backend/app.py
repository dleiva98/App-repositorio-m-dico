from flask import Flask, request, jsonify, g, render_template
from flask_cors import CORS
import pymysql
import bcrypt
import jwt
import datetime
import os
from database import get_db, close_db

app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)

app.config['SECRET_KEY'] = os.getenv('JWT_SECRET', 'secreto_para_demo')

# Registrar la función de cierre de la base de datos
app.teardown_appcontext(close_db)

# --- Helper functions ---
def hash_password(password):
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def check_password(hashed_password, password):
    return bcrypt.checkpw(password.encode('utf-8'), hashed_password.encode('utf-8'))

def generate_token(user_id, email):
    payload = {
        'user_id': user_id,
        'email': email,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

def verify_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

# --- Routes ---
@app.route('/')
def serve_frontend():
    return app.send_static_file('index.html')

# --- API Endpoints ---

# [GET] /api/usuarios
@app.route('/api/usuarios', methods=['GET'])
def listar_usuarios():
    db = get_db()
    with db.cursor() as cursor:
        page = int(request.args.get('page', 1))
        limit = int(request.args.get('limit', 20))
        offset = (page - 1) * limit

        cursor.execute("SELECT id, nombre, correo, telefono FROM usuarios LIMIT %s OFFSET %s", (limit, offset))
        usuarios = cursor.fetchall()

        cursor.execute("SELECT COUNT(*) as total FROM usuarios")
        total = cursor.fetchone()['total']

        total_paginas = (total + limit - 1) // limit

        return jsonify({
            'usuarios': usuarios,
            'total': total,
            'pagina': page,
            'totalPaginas': total_paginas
        })

# [POST] /api/usuarios
@app.route('/api/usuarios', methods=['POST'])
def crear_usuario():
    data = request.get_json()
    if not data:
        return jsonify({'mensaje': 'Datos JSON requeridos'}), 400

    required_fields = ['nombre', 'correo', 'contrasena']
    for field in required_fields:
        if field not in data:
            return jsonify({'mensaje': f'El campo {field} es obligatorio'}), 400

    nombre = data['nombre']
    correo = data['correo']
    contrasena = data['contrasena']
    telefono = data.get('telefono')

    # Verificar si el correo ya existe
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("SELECT id FROM usuarios WHERE correo = %s", (correo,))
        if cursor.fetchone():
            return jsonify({'mensaje': 'El correo ya está registrado'}), 400

        hashed_pw = hash_password(contrasena)
        cursor.execute(
            "INSERT INTO usuarios (nombre, correo, contrasena, telefono) VALUES (%s, %s, %s, %s)",
            (nombre, correo, hashed_pw, telefono)
        )
        db.commit()

        new_id = cursor.lastrowid
        cursor.execute("SELECT id, nombre, correo, telefono FROM usuarios WHERE id = %s", (new_id,))
        new_user = cursor.fetchone()

        return jsonify(new_user), 201

# [POST] /api/auth/login
@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data:
        return jsonify({'mensaje': 'Datos JSON requeridos'}), 400

    correo = data.get('correo')
    contrasena = data.get('contrasena')

    if not correo or not contrasena:
        return jsonify({'mensaje': 'Correo y contraseña son obligatorios'}), 400

    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("SELECT * FROM usuarios WHERE correo = %s", (correo,))
        user = cursor.fetchone()

        if user and check_password(user['contrasena'], contrasena):
            token = generate_token(user['id'], user['correo'])
            # Remover contraseña del response
            user_data = {
                'id': user['id'],
                'nombre': user['nombre'],
                'correo': user['correo'],
                'telefono': user['telefono']
            }
            return jsonify({'token': token, 'usuario': user_data}), 200
        else:
            return jsonify({'mensaje': 'Correo o contraseña incorrectos'}), 401

# [GET] /api/profesionales
@app.route('/api/profesionales', methods=['GET'])
def buscar_profesionales():
    especialidad = request.args.get('especialidad')
    ubicacion = request.args.get('ubicacion')
    nombre = request.args.get('nombre')
    seguro_id = request.args.get('seguroId')
    sin_seguro = request.args.get('sinSeguro')

    db = get_db()
    with db.cursor() as cursor:
        query = """
            SELECT p.*, 
                GROUP_CONCAT(s.id) AS seguros_ids,
                GROUP_CONCAT(s.nombre) AS seguros_nombres
            FROM profesionales p
            LEFT JOIN profesional_seguro ps ON p.id = ps.profesional_id
            LEFT JOIN seguros s ON ps.seguro_id = s.id
        """
        conditions = []
        params = []

        if especialidad:
            conditions.append("p.especialidad LIKE %s")
            params.append(f"%{especialidad}%")
        if ubicacion:
            conditions.append("p.ubicacion LIKE %s")
            params.append(f"%{ubicacion}%")
        if nombre:
            conditions.append("p.nombre LIKE %s")
            params.append(f"%{nombre}%")
        if seguro_id:
            conditions.append("s.id = %s")
            params.append(seguro_id)
        if sin_seguro == 'true':
            conditions.append("ps.profesional_id IS NULL")

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " GROUP BY p.id"

        cursor.execute(query, params)
        profesionales = cursor.fetchall()

        if not profesionales:
            return jsonify({'mensaje': 'No se encontraron profesionales'}), 404

        # Formatear la respuesta
        results = []
        for prof in profesionales:
            seguros_aceptados = []
            if prof['seguros_ids'] and prof['seguros_nombres']:
                ids = prof['seguros_ids'].split(',')
                nombres = prof['seguros_nombres'].split(',')
                seguros_aceptados = [{'id': int(id), 'nombre': nom} for id, nom in zip(ids, nombres)]

            results.append({
                'id': prof['id'],
                'nombre': prof['nombre'],
                'especialidad': prof['especialidad'],
                'ubicacion': prof['ubicacion'],
                'contacto': prof['contacto'],
                'segurosAceptados': seguros_aceptados
            })

        return jsonify(results)

# [GET] /api/profesionales/<int:profesional_id>
@app.route('/api/profesionales/<int:profesional_id>', methods=['GET'])
def obtener_profesional(profesional_id):
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("""
            SELECT p.*, 
                GROUP_CONCAT(s.id) AS seguros_ids,
                GROUP_CONCAT(s.nombre) AS seguros_nombres
            FROM profesionales p
            LEFT JOIN profesional_seguro ps ON p.id = ps.profesional_id
            LEFT JOIN seguros s ON ps.seguro_id = s.id
            WHERE p.id = %s
            GROUP BY p.id
        """, (profesional_id,))
        prof = cursor.fetchone()

        if not prof:
            return jsonify({'mensaje': 'El profesional no existe'}), 404

        seguros_aceptados = []
        if prof['seguros_ids'] and prof['seguros_nombres']:
            ids = prof['seguros_ids'].split(',')
            nombres = prof['seguros_nombres'].split(',')
            seguros_aceptados = [{'id': int(id), 'nombre': nom} for id, nom in zip(ids, nombres)]

        result = {
            'id': prof['id'],
            'nombre': prof['nombre'],
            'especialidad': prof['especialidad'],
            'ubicacion': prof['ubicacion'],
            'contacto': prof['contacto'],
            'segurosAceptados': seguros_aceptados
        }

        return jsonify(result)

# [GET] /api/seguros
@app.route('/api/seguros', methods=['GET'])
def listar_seguros():
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("SELECT * FROM seguros")
        seguros = cursor.fetchall()
        if not seguros:
            return jsonify({'mensaje': 'No hay seguros disponibles'}), 404
        return jsonify(seguros)

# [GET] /api/citas
@app.route('/api/citas', methods=['GET'])
def listar_citas():
    db = get_db()
    with db.cursor() as cursor:
        page = int(request.args.get('page', 1))
        limit = int(request.args.get('limit', 20))
        offset = (page - 1) * limit

        cursor.execute("""
            SELECT c.*, u.nombre as usuario_nombre, p.nombre as profesional_nombre
            FROM citas c
            INNER JOIN usuarios u ON c.usuario_id = u.id
            INNER JOIN profesionales p ON c.profesional_id = p.id
            ORDER BY c.fecha_hora DESC
            LIMIT %s OFFSET %s
        """, (limit, offset))
        citas = cursor.fetchall()

        cursor.execute("SELECT COUNT(*) as total FROM citas")
        total = cursor.fetchone()['total']

        total_paginas = (total + limit - 1) // limit

        # Formatear las citas
        citas_list = []
        for cita in citas:
            citas_list.append({
                'id': cita['id'],
                'fechaHora': cita['fecha_hora'].isoformat() if cita['fecha_hora'] else None,
                'motivo': cita['motivo'],
                'usuario': {
                    'id': cita['usuario_id'],
                    'nombre': cita['usuario_nombre']
                },
                'profesional': {
                    'id': cita['profesional_id'],
                    'nombre': cita['profesional_nombre']
                }
            })

        return jsonify({
            'citas': citas_list,
            'total': total,
            'pagina': page,
            'totalPaginas': total_paginas
        })

# [POST] /api/citas
@app.route('/api/citas', methods=['POST'])
def crear_cita():
    data = request.get_json()
    if not data:
        return jsonify({'mensaje': 'Datos JSON requeridos'}), 400

    usuario_id = data.get('usuarioId')
    profesional_id = data.get('profesionalId')
    fecha_hora = data.get('fechaHora')
    motivo = data.get('motivo')

    if not usuario_id or not profesional_id or not fecha_hora:
        return jsonify({'mensaje': 'usuarioId, profesionalId y fechaHora son obligatorios'}), 400

    # Verificar que el usuario y profesional existen
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("SELECT id FROM usuarios WHERE id = %s", (usuario_id,))
        if not cursor.fetchone():
            return jsonify({'mensaje': 'Usuario no encontrado'}), 404

        cursor.execute("SELECT id FROM profesionales WHERE id = %s", (profesional_id,))
        if not cursor.fetchone():
            return jsonify({'mensaje': 'Profesional no encontrado'}), 404

        # Verificar que la fecha no esté en el pasado
        from datetime import datetime
        ahora = datetime.now()
        fecha_cita = datetime.strptime(fecha_hora, '%Y-%m-%d %H:%M:%S')
        if fecha_cita < ahora:
            return jsonify({'mensaje': 'La fecha de la cita no puede ser en el pasado'}), 400

        # Verificar disponibilidad (simplificado: mismo profesional y misma fecha_hora)
        cursor.execute(
            "SELECT id FROM citas WHERE profesional_id = %s AND fecha_hora = %s",
            (profesional_id, fecha_hora)
        )
        if cursor.fetchone():
            return jsonify({'mensaje': 'El horario seleccionado no está disponible'}), 409

        # Insertar la cita
        cursor.execute(
            "INSERT INTO citas (usuario_id, profesional_id, fecha_hora, motivo) VALUES (%s, %s, %s, %s)",
            (usuario_id, profesional_id, fecha_hora, motivo)
        )
        db.commit()

        new_id = cursor.lastrowid

        # Obtener la cita recién creada con información de usuario y profesional
        cursor.execute("""
            SELECT c.*, u.nombre as usuario_nombre, p.nombre as profesional_nombre
            FROM citas c
            INNER JOIN usuarios u ON c.usuario_id = u.id
            INNER JOIN profesionales p ON c.profesional_id = p.id
            WHERE c.id = %s
        """, (new_id,))
        new_cita = cursor.fetchone()

        cita_response = {
            'id': new_cita['id'],
            'fechaHora': new_cita['fecha_hora'].isoformat(),
            'motivo': new_cita['motivo'],
            'usuario': {
                'id': new_cita['usuario_id'],
                'nombre': new_cita['usuario_nombre']
            },
            'profesional': {
                'id': new_cita['profesional_id'],
                'nombre': new_cita['profesional_nombre']
            }
        }

        return jsonify(cita_response), 201

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
